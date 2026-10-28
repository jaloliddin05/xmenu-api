import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type Redis from 'ioredis';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { REDIS } from 'src/infra/redis/redis.module';
import { isValidPhone } from 'src/infra/helper/auth/customer-validators';
import formatPhoneNumber from 'src/infra/helper/auth/format-phone';
import { hashPassword } from 'src/infra/helper/auth/hash-password';
import { toStaffUser } from 'src/infra/helper/auth/staff-user';
import { OrganizationService } from 'src/modules/organization/services/organization.service';
import { CUSTOMER_AUTH_CONFIG } from '../customer-auth.config';
import type { CustomerAuthConfig } from '../customer-auth.config';
import { CustomerAuthException } from '../errors/customer-auth.exception';
import { JwtTokenService } from '../jwt.service';
import type { StaffRegisterDto } from '../dto/staff-register.dto';
import { CustomerOtpService } from './customer-otp.service';
import type { RequestCtx } from './customer-auth-event.service';
import { RateLimitService } from './rate-limit.service';
import { StaffAuthEventService } from './staff-auth-event.service';
import { StaffLoginThrottleService } from './staff-login-throttle.service';

/** How long a signup waits for its phone code; every resend extends it. */
export const PENDING_REGISTRATION_TTL_SECONDS = 1800;
const OTP_BRAND = 'Xmenu';
const SLUG_RETRIES = 3;
export const LOGIN_IP_LIMIT = 20;
const LOGIN_IP_WINDOW_SECONDS = 900;

// Compared against when the phone is unknown, so both failures cost one bcrypt round of the same cost
// as hashPassword(); the plaintext is random and thrown away.
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), 10);

interface PendingRegistration {
  phone: string;
  name: string;
  type: string;
  first_name: string;
  last_name?: string;
  passwordHash: string;
}

const USER_WITH_ORGANIZATION = {
  organization: { include: { logo: true, banner: true, translations: true } },
} satisfies Prisma.userInclude;

/**
 * Owner signup. Nothing is written to Postgres until the phone is confirmed: the signup waits in Redis
 * under a random registrationId, and the code (sent via SmsProvider, hashed in Redis) confirms exactly
 * that signup. A second signup for the same phone gets its own id and code, so it cannot hijack the first.
 */
@Injectable()
export class StaffAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationService,
    private readonly otp: CustomerOtpService,
    private readonly rateLimit: RateLimitService,
    private readonly events: StaffAuthEventService,
    private readonly throttle: StaffLoginThrottleService,
    private readonly tokens: JwtTokenService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CUSTOMER_AUTH_CONFIG) private readonly cfg: CustomerAuthConfig,
  ) {}

  // ================= POST /auth/register =================

  async register(dto: StaffRegisterDto, ctx: RequestCtx) {
    if (!isValidPhone(dto.phone))
      throw new CustomerAuthException('invalid_phone');
    await this.rateLimit.hit([
      { key: `staff:reg:rl:ip:${ctx.ip}`, limit: 10, ttlSeconds: 3600 },
    ]);

    const existing = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
      select: { isActive: true },
    });
    if (existing?.isActive) throw new CustomerAuthException('phone_taken');

    const registrationId = randomUUID();
    const pending: PendingRegistration = {
      phone: dto.phone,
      name: dto.name,
      type: dto.type,
      first_name: dto.first_name,
      last_name: dto.last_name || undefined,
      passwordHash: await hashPassword(dto.password),
    };
    const key = this.pendingKey(registrationId);
    await this.redis.set(
      key,
      JSON.stringify(pending),
      'EX',
      PENDING_REGISTRATION_TTL_SECONDS,
    );

    let resendAfter: number;
    try {
      resendAfter = await this.sendCode(registrationId, pending.phone, ctx);
    } catch (err) {
      await this.redis.del(key);
      throw err;
    }
    return {
      registrationId,
      resendAfter,
      codeLength: this.cfg.otpLength,
      expiresIn: this.cfg.otpTtlSeconds,
    };
  }

  // ================= POST /auth/resend-code =================

  async resendCode(registrationId: string, ctx: RequestCtx) {
    const pending = await this.readPending(registrationId);
    const resendAfter = await this.sendCode(registrationId, pending.phone, ctx);
    await this.redis.expire(
      this.pendingKey(registrationId),
      PENDING_REGISTRATION_TTL_SECONDS,
    );
    return { resendAfter, expiresIn: this.cfg.otpTtlSeconds };
  }

  // ================= POST /auth/check-code =================

  async checkCode(
    dto: { registrationId: string; code: string },
    ctx: RequestCtx,
  ) {
    // A malformed code does not spend an attempt
    if (!this.otp.isValidCodeFormat(dto.code))
      throw new CustomerAuthException('invalid_code');
    const pending = await this.readPending(dto.registrationId);
    const { phone } = pending;

    await this.rateLimit.hit([
      { key: `sverify:rl:${phone}:${ctx.ip}`, limit: 10, ttlSeconds: 900 },
      { key: `sverify:rl:ip:${ctx.ip}`, limit: 60, ttlSeconds: 900 },
    ]);

    await this.otp.consume(
      dto.registrationId,
      phone,
      dto.code,
      {
        onFailed: () => this.events.log('staff_otp_failed', ctx, { phone }),
        onLocked: () => this.events.log('staff_otp_locked', ctx, { phone }),
      },
      'staff',
    );

    // Only the request that removes the pending signup may create the account
    if ((await this.redis.del(this.pendingKey(dto.registrationId))) !== 1) {
      throw new CustomerAuthException('registration_expired');
    }

    const user = await this.createAccount(pending);
    await this.events.log('staff_registered', ctx, {
      userId: user.id,
      organizationId: user.organization?.id,
      phone,
    });
    return {
      success: true,
      user: toStaffUser(user),
      accessToken: this.tokens.getJWT('access', user.id, 'user'),
      refreshToken: this.tokens.getJWT('refresh', user.id, 'user'),
    };
  }

  // ================= POST /auth/login =================

  /**
   * Unknown phone, unconfirmed account and wrong password are indistinguishable: same error, same
   * status, one bcrypt comparison each, and the same lockout counters.
   */
  async login(dto: { login: string; password: string }, ctx: RequestCtx) {
    const phone = formatPhoneNumber(String(dto.login ?? '')).slice(0, 20);
    await this.rateLimit.hit([
      {
        key: `staff:login:rl:ip:${ctx.ip}`,
        limit: LOGIN_IP_LIMIT,
        ttlSeconds: LOGIN_IP_WINDOW_SECONDS,
      },
    ]);
    await this.throttle.assertNotLocked(phone);

    const user = isValidPhone(phone)
      ? await this.prisma.user.findUnique({
          where: { phone },
          include: USER_WITH_ORGANIZATION,
        })
      : null;
    const hash = user?.isActive && user.password ? user.password : null;
    const matches = await bcrypt.compare(
      String(dto.password ?? ''),
      hash ?? DUMMY_HASH,
    );

    if (!hash || !matches) {
      const lockedFor = await this.throttle.registerFailure(phone);
      await this.events.log('staff_login_failed', ctx, {
        phone,
        userId: user?.id,
      });
      if (lockedFor) {
        await this.events.log('staff_login_locked', ctx, {
          phone,
          userId: user?.id,
          meta: { seconds: lockedFor },
        });
      }
      throw new CustomerAuthException(
        'invalid_credentials',
        'Invalid phone or password',
      );
    }

    await this.throttle.reset(phone);
    await this.events.log('staff_login', ctx, {
      userId: user!.id,
      organizationId: user!.organization?.id,
      phone,
    });
    return {
      accessToken: this.tokens.getJWT('access', user!.id, 'user'),
      refreshToken: this.tokens.getJWT('refresh', user!.id, 'user'),
      user: toStaffUser(user!),
    };
  }

  // ================= helpers =================

  private pendingKey(registrationId: string) {
    return `staff:reg:${registrationId}`;
  }

  private async readPending(
    registrationId: string,
  ): Promise<PendingRegistration> {
    const raw = await this.redis.get(this.pendingKey(registrationId));
    if (!raw) throw new CustomerAuthException('registration_expired');
    return JSON.parse(raw) as PendingRegistration;
  }

  private async sendCode(
    registrationId: string,
    phone: string,
    ctx: RequestCtx,
  ): Promise<number> {
    try {
      const resendAfter = await this.otp.request(
        { id: registrationId, brandName: OTP_BRAND },
        phone,
        ctx.ip,
        'staff',
      );
      await this.events.log('staff_otp_requested', ctx, { phone });
      return resendAfter;
    } catch (err) {
      if (
        err instanceof CustomerAuthException &&
        err.code === 'sms_unavailable'
      ) {
        await this.events.log('staff_otp_send_failed', ctx, { phone });
      }
      throw err;
    }
  }

  /** Creates the owner and the venue in one transaction; reuses an unconfirmed row left by the old signup flow. */
  private async createAccount(p: PendingRegistration) {
    for (let attempt = 1; ; attempt++) {
      try {
        const userId = await this.prisma.$transaction(async (tx) => {
          const existing = await tx.user.findUnique({
            where: { phone: p.phone },
          });
          if (existing?.isActive)
            throw new CustomerAuthException('phone_taken');

          const data = {
            first_name: p.first_name,
            last_name: p.last_name ?? null,
            password: p.passwordHash,
            isActive: true,
          };
          const user = existing
            ? await tx.user.update({ where: { id: existing.id }, data })
            : await tx.user.create({ data: { phone: p.phone, ...data } });

          const org = await this.organizations.create(
            { name: p.name, type: p.type },
            user.id,
            tx,
          );
          await tx.organization.update({
            where: { id: org.id },
            data: { is_active: true },
          });
          return user.id;
        });
        return await this.prisma.user.findUniqueOrThrow({
          where: { id: userId },
          include: USER_WITH_ORGANIZATION,
        });
      } catch (err) {
        if (
          !(err instanceof Prisma.PrismaClientKnownRequestError) ||
          err.code !== 'P2002'
        )
          throw err;
        const raw = err.meta?.target;
        const target = Array.isArray(raw)
          ? raw.join(',')
          : typeof raw === 'string'
            ? raw
            : '';
        if (target.includes('phone'))
          throw new CustomerAuthException('phone_taken');
        // Two venues with the same name signing up at once collide on the slug: try a fresh one
        if (target.includes('slug') && attempt < SLUG_RETRIES) continue;
        throw err;
      }
    }
  }
}
