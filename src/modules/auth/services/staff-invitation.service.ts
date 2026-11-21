import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  AppException,
  platformMisconfigured,
} from 'src/infra/errors/app-exception';
import { isValidPhone } from 'src/infra/helper/auth/customer-validators';
import { hashPassword } from 'src/infra/helper/auth/hash-password';
import {
  STAFF_USER_INCLUDE,
  toStaffUser,
} from 'src/infra/helper/auth/staff-user';
import { errorMessage } from 'src/infra/helper/error-text';
import { isSmsConfigured } from 'src/modules/sms/sms.module';
import { SMS_PROVIDER } from 'src/modules/sms/providers/sms-provider.interface';
import type { SmsProvider } from 'src/modules/sms/providers/sms-provider.interface';
import { CUSTOMER_AUTH_CONFIG } from '../customer-auth.config';
import type { CustomerAuthConfig } from '../customer-auth.config';
import type {
  StaffInvitationAcceptDto,
  StaffInvitationCodeDto,
} from '../dto/staff-invitation.dto';
import type { RequestCtx } from './customer-auth-event.service';
import { SmsBudgetService } from 'src/modules/sms/sms-budget.service';
import { CustomerOtpService, SMS_TEXT } from './customer-otp.service';
import { RateLimitService } from './rate-limit.service';
import { StaffAuthEventService } from './staff-auth-event.service';
import { StaffSessionService } from './staff-session.service';

const OTP_BRAND = 'Xmenu';
/** Subject of invitation codes: bound to the phone, apart from sign-up and password reset codes. */
export const INVITE_SUBJECT = 'invite';
const ACCEPT_WINDOW_SECONDS = 900;

/** An invitation that can still be accepted: invited, not expired. */
export const openInvitationWhere = (
  now: Date,
): Prisma.organization_memberWhereInput => ({
  status: 'invited',
  invite_expires_at: { gt: now },
});

/** Rolls the accept transaction back when the invitation stopped being open under it. */
class InvitationGone extends Error {}

/**
 * An invited operator confirms the phone with a code (same OTP limits and SMS provider as sign-up)
 * and sets the password. Like password recovery, the code request answers the same for any phone:
 * the code goes out only when the phone has an open invitation and no account.
 */
@Injectable()
export class StaffInvitationService {
  private readonly logger = new Logger('StaffInvitation');

  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: CustomerOtpService,
    private readonly rateLimit: RateLimitService,
    private readonly events: StaffAuthEventService,
    private readonly sessions: StaffSessionService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(CUSTOMER_AUTH_CONFIG) private readonly cfg: CustomerAuthConfig,
    private readonly smsBudget: SmsBudgetService,
  ) {}

  // ================= POST /auth/invitation/code =================

  async requestCode(dto: StaffInvitationCodeDto, ctx: RequestCtx) {
    const phone = dto.phone;
    if (!isValidPhone(phone)) throw new AppException('invalid_phone');
    if (!this.cfg.otpDevMode && !isSmsConfigured())
      throw platformMisconfigured(
        'sms',
        'the SMS provider (SMS_PROVIDER) lacks its credentials',
      );

    // The SMS below is not awaited, so the daily ceiling is checked here, for any phone alike (same answer)
    await this.smsBudget.assertAvailable();

    const invitation = await this.findAcceptable(phone);
    const resendAfter = await this.otp.issue(
      { id: INVITE_SUBJECT, brandName: OTP_BRAND },
      phone,
      {
        ip: ctx.ip,
        scope: 'staff',
        purpose: INVITE_SUBJECT,
        deliver: (code) => {
          if (!invitation) return Promise.resolve();
          void this.sms
            .send(phone, SMS_TEXT.staff.ru(OTP_BRAND, code))
            .catch((err: unknown) => {
              this.logger.warn(
                `invitation code not delivered: ${errorMessage(err)}`,
              );
            });
          return Promise.resolve();
        },
      },
    );
    await this.events.log('staff_invite_code_requested', ctx, {
      organizationId: invitation?.organization_id,
      phone,
    });
    return {
      resendAfter,
      codeLength: this.cfg.otpLength,
      expiresIn: this.cfg.otpTtlSeconds,
    };
  }

  // ================= POST /auth/invitation/accept =================

  /** Creates the operator's account, activates the invitation and signs the operator in. */
  async accept(dto: StaffInvitationAcceptDto, ctx: RequestCtx) {
    const { phone, code } = dto;
    if (!isValidPhone(phone)) throw new AppException('invalid_phone');
    // A malformed code must not spend an attempt
    if (!this.otp.isValidCodeFormat(code))
      throw new AppException('invalid_code');

    await this.rateLimit.hit([
      {
        key: `sinvite:rl:${phone}:${ctx.ip}`,
        limit: 10,
        ttlSeconds: ACCEPT_WINDOW_SECONDS,
      },
      {
        key: `sinvite:rl:ip:${ctx.ip}`,
        limit: 60,
        ttlSeconds: ACCEPT_WINDOW_SECONDS,
      },
    ]);

    await this.otp.consume(
      INVITE_SUBJECT,
      phone,
      code,
      {
        onFailed: () => this.events.log('staff_otp_failed', ctx, { phone }),
        onLocked: () => this.events.log('staff_otp_locked', ctx, { phone }),
      },
      'staff',
    );

    const accepted = await this.activate(
      phone,
      await hashPassword(dto.password),
    );
    // Reachable without an open invitation only with the fixed development code, or when the invitation
    // was cancelled or accepted meanwhile
    if (!accepted) throw new AppException('code_expired');

    await this.events.log('staff_invite_accepted', ctx, {
      userId: accepted.userId,
      organizationId: accepted.organizationId,
      phone,
    });
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: accepted.userId },
      include: STAFF_USER_INCLUDE,
    });
    return {
      success: true as const,
      user: toStaffUser(user),
      ...(await this.sessions.create(user.id, ctx)),
    };
  }

  /** The open invitation of a phone that has no account yet (an account blocks every invitation). */
  private async findAcceptable(phone: string) {
    const [invitation, user] = await Promise.all([
      this.prisma.organization_member.findFirst({
        where: { phone, ...openInvitationWhere(new Date()) },
        select: { id: true, organization_id: true },
      }),
      this.prisma.user.findUnique({ where: { phone }, select: { id: true } }),
    ]);
    return user ? null : invitation;
  }

  private async activate(phone: string, passwordHash: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const invitation = await tx.organization_member.findFirst({
          where: { phone, ...openInvitationWhere(now) },
        });
        if (!invitation) return null;
        // user.phone is unique: a concurrent accept or sign-up for the phone fails here (P2002)
        const user = await tx.user.create({
          data: {
            phone,
            password: passwordHash,
            first_name: invitation.first_name,
            last_name: invitation.last_name,
            isActive: true,
          },
        });
        // Only while the row is still an open invitation: the owner may cancel it meanwhile
        const { count } = await tx.organization_member.updateMany({
          where: { id: invitation.id, ...openInvitationWhere(now) },
          data: {
            user_id: user.id,
            status: 'active',
            activated_at: now,
            invite_expires_at: null,
          },
        });
        if (count !== 1) throw new InvitationGone();
        return { userId: user.id, organizationId: invitation.organization_id };
      });
    } catch (err) {
      if (
        err instanceof InvitationGone ||
        (err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002')
      )
        return null;
      throw err;
    }
  }
}
