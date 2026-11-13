import { Inject, Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  AppException,
  platformMisconfigured,
} from 'src/infra/errors/app-exception';
import { isValidPhone } from 'src/infra/helper/auth/customer-validators';
import { hashPassword } from 'src/infra/helper/auth/hash-password';
import { errorMessage } from 'src/infra/helper/error-text';
import { isSmsConfigured } from 'src/modules/sms/sms.module';
import { SMS_PROVIDER } from 'src/modules/sms/providers/sms-provider.interface';
import type { SmsProvider } from 'src/modules/sms/providers/sms-provider.interface';
import { CUSTOMER_AUTH_CONFIG } from '../customer-auth.config';
import type { CustomerAuthConfig } from '../customer-auth.config';
import type {
  StaffChangePasswordDto,
  StaffForgotPasswordDto,
  StaffResetPasswordDto,
} from '../dto/staff-password.dto';
import type { RequestCtx } from './customer-auth-event.service';
import { CustomerOtpService, SMS_TEXT } from './customer-otp.service';
import { RateLimitService } from './rate-limit.service';
import { StaffAuthEventService } from './staff-auth-event.service';
import { StaffLoginThrottleService } from './staff-login-throttle.service';
import { StaffSessionService } from './staff-session.service';

const OTP_BRAND = 'Xmenu';
/** Subject of reset codes: the code is bound to the phone, and cannot be mixed up with a registration code. */
export const RESET_SUBJECT = 'pwreset';
const RESET_VERIFY_WINDOW_SECONDS = 900;
const CHANGE_WINDOW_SECONDS = 900;
const CHANGE_USER_LIMIT = 5;
const CHANGE_IP_LIMIT = 20;

/**
 * Password recovery (code by SMS) and change from the profile. Both end with the other logins of the owner revoked.
 */
@Injectable()
export class StaffPasswordService {
  private readonly logger = new Logger('StaffPassword');

  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: CustomerOtpService,
    private readonly rateLimit: RateLimitService,
    private readonly events: StaffAuthEventService,
    private readonly throttle: StaffLoginThrottleService,
    private readonly sessions: StaffSessionService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(CUSTOMER_AUTH_CONFIG) private readonly cfg: CustomerAuthConfig,
  ) {}

  // ================= POST /auth/password/forgot =================

  /**
   * Same answer, same limits and same work for a known and an unknown phone: both go through `otp.issue`, only the
   * delivery differs, and it is not awaited, so response time does not show whether the phone has an account.
   */
  async forgot(dto: StaffForgotPasswordDto, ctx: RequestCtx) {
    const phone = dto.phone;
    if (!isValidPhone(phone)) throw new AppException('invalid_phone');
    if (!this.cfg.otpDevMode && !isSmsConfigured())
      throw platformMisconfigured(
        'sms',
        'the SMS provider (SMS_PROVIDER) lacks its credentials',
      );

    const user = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true, isActive: true },
    });
    const known = !!user?.isActive;

    const resendAfter = await this.otp.issue(
      { id: RESET_SUBJECT, brandName: OTP_BRAND },
      phone,
      {
        ip: ctx.ip,
        scope: 'staff',
        purpose: RESET_SUBJECT,
        deliver: (code) => {
          if (!known) return Promise.resolve();
          void this.sms
            .send(phone, SMS_TEXT.staff.ru(OTP_BRAND, code))
            .catch((err: unknown) => {
              this.logger.warn(
                `reset code not delivered: ${errorMessage(err)}`,
              );
            });
          return Promise.resolve();
        },
      },
    );
    await this.events.log('staff_password_reset_requested', ctx, {
      userId: known ? user.id : undefined,
      phone,
    });
    return {
      resendAfter,
      codeLength: this.cfg.otpLength,
      expiresIn: this.cfg.otpTtlSeconds,
    };
  }

  // ================= POST /auth/password/reset =================

  async reset(dto: StaffResetPasswordDto, ctx: RequestCtx): Promise<void> {
    const { phone, code } = dto;
    if (!isValidPhone(phone)) throw new AppException('invalid_phone');
    // A malformed code must not spend an attempt
    if (!this.otp.isValidCodeFormat(code))
      throw new AppException('invalid_code');

    await this.rateLimit.hit([
      {
        key: `spwreset:rl:${phone}:${ctx.ip}`,
        limit: 10,
        ttlSeconds: RESET_VERIFY_WINDOW_SECONDS,
      },
      {
        key: `spwreset:rl:ip:${ctx.ip}`,
        limit: 60,
        ttlSeconds: RESET_VERIFY_WINDOW_SECONDS,
      },
    ]);

    await this.otp.consume(
      RESET_SUBJECT,
      phone,
      code,
      {
        onFailed: () => this.events.log('staff_otp_failed', ctx, { phone }),
        onLocked: () => this.events.log('staff_otp_locked', ctx, { phone }),
      },
      'staff',
    );

    const user = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true, isActive: true },
    });
    // Only reachable for an unknown phone with a fixed development code
    if (!user?.isActive) throw new AppException('code_expired');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: await hashPassword(dto.newPassword) },
    });
    await this.sessions.revokeAllForUser(user.id);
    await this.throttle.reset(phone);
    await this.events.log('staff_password_reset', ctx, {
      userId: user.id,
      phone,
    });
  }

  // ================= POST /auth/password/change =================

  async change(
    userId: string,
    currentSid: string,
    dto: StaffChangePasswordDto,
    ctx: RequestCtx,
  ): Promise<void> {
    await this.rateLimit.hit([
      {
        key: `staff:pwchange:rl:user:${userId}`,
        limit: CHANGE_USER_LIMIT,
        ttlSeconds: CHANGE_WINDOW_SECONDS,
      },
      {
        key: `staff:pwchange:rl:ip:${ctx.ip}`,
        limit: CHANGE_IP_LIMIT,
        ttlSeconds: CHANGE_WINDOW_SECONDS,
      },
    ]);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true, phone: true },
    });
    if (!user)
      throw new AppException('not_found', { message: 'User not found' });
    const same =
      !!user.password &&
      (await bcrypt.compare(dto.currentPassword, user.password));
    if (!same) throw new AppException('wrong_password');

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await hashPassword(dto.newPassword) },
    });
    const ended = await this.sessions.revokeAllForUser(userId, currentSid);
    await this.events.log('staff_password_changed', ctx, {
      userId,
      meta: { sessions_ended: ended },
    });
  }
}
