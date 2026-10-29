import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { REDIS } from 'src/infra/redis/redis.module';
import { SMS_PROVIDER } from 'src/modules/sms/providers/sms-provider.interface';
import type { SmsProvider } from 'src/modules/sms/providers/sms-provider.interface';
import { CUSTOMER_AUTH_CONFIG } from '../customer-auth.config';
import type { CustomerAuthConfig } from '../customer-auth.config';
import { CustomerAuthException } from '../errors/customer-auth.exception';
import { RateLimitService, RateRule } from './rate-limit.service';

const SEND_TIMEOUT_MS = 5000;

// attempts'ni oshiradi va saqlangan hash'ni qaytaradi (kalit yo'q bo'lsa nil)
export const BUMP_LUA = `
local h = redis.call('HGET', KEYS[1], 'h')
if not h then return nil end
local a = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
return {h, a}
`;

/**
 * Who the code is for. Each audience has its own keys and rate-limit counters, so a restaurant
 * owner who also orders as a customer does not burn one limit with the other.
 */
export type OtpScope = 'customer' | 'staff';

const KEY_PREFIX: Record<OtpScope, string> = { customer: 'otp', staff: 'sotp' };

const SMS_TEXT: Record<OtpScope, Record<'uz' | 'ru', (brand: string, code: string) => string>> = {
  customer: {
    uz: (brand, code) => `${brand} ga kirish uchun kod: ${code}. Hech kimga bermang.`,
    ru: (brand, code) => `Код для входа в ${brand}: ${code}. Никому не сообщайте.`,
  },
  staff: {
    uz: (brand, code) => `${brand} tasdiqlash kodi: ${code}. Hech kimga bermang.`,
    ru: (brand, code) => `Код подтверждения ${brand}: ${code}. Никому не сообщайте.`,
  },
};

@Injectable()
export class CustomerOtpService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CUSTOMER_AUTH_CONFIG) private readonly cfg: CustomerAuthConfig,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly rateLimit: RateLimitService,
  ) {}

  private otpKey(scope: OtpScope, subjectId: string, phone: string) {
    return `${KEY_PREFIX[scope]}:${subjectId}:${phone}`;
  }

  private hmac(scope: OtpScope, subjectId: string, phone: string, code: string): Buffer {
    // Customer input is unchanged so codes issued before this change stay valid
    const input =
      scope === 'customer' ? `${subjectId}:${phone}:${code}` : `${scope}:${subjectId}:${phone}:${code}`;
    return createHmac('sha256', this.cfg.otpHmacSecret).update(input).digest();
  }

  private generateCode(): string {
    if (this.cfg.otpDevMode) return '1234567890'.slice(0, this.cfg.otpLength);
    return randomInt(0, 10 ** this.cfg.otpLength).toString().padStart(this.cfg.otpLength, '0');
  }

  isValidCodeFormat(code: unknown): code is string {
    return typeof code === 'string' && new RegExp(`^\\d{${this.cfg.otpLength}}$`).test(code);
  }

  /** otp/request: customers jadvaliga umuman tegmaydi. Qaytaradi: resendAfter (sekund). */
  async request(
    tenant: { id: string; brandName: string },
    phone: string,
    ip: string,
    scope: OtpScope = 'customer',
  ): Promise<number> {
    return this.issue(tenant, phone, {
      ip,
      scope,
      deliver: (code) => this.sms.send(phone, SMS_TEXT[scope][this.cfg.smsLocale](tenant.brandName, code)),
    });
  }

  /**
   * Creates a code (stored hashed, one-time, attempt-limited) and hands it to `deliver`.
   * SMS and Telegram share the same store and the same per-phone limits, so a phone cannot be
   * flooded by alternating channels. `ip` is optional: the Telegram webhook does not know it.
   */
  async issue(
    tenant: { id: string; brandName: string },
    phone: string,
    opts: {
      ip?: string;
      scope?: OtpScope;
      deliver: (code: string) => Promise<void>;
      /** Deliver even in OTP_DEV_MODE (the fixed dev code is otherwise never sent). */
      alwaysDeliver?: boolean;
      unavailableCode?: 'sms_unavailable' | 'telegram_unavailable';
    },
  ): Promise<number> {
    const scope = opts.scope ?? 'customer';
    // Telefon bo'yicha kalitlarda tenant YO'Q (tenant klientdan keladi — aylanib o'tib bo'lmasin)
    const p = KEY_PREFIX[scope];
    const rules: RateRule[] = [
      { key: `${p}:cd:${phone}`, limit: 1, ttlSeconds: this.cfg.otpCooldownSeconds },
      { key: `${p}:rl:phone:h:${phone}`, limit: 5, ttlSeconds: 3600 },
      { key: `${p}:rl:phone:d:${phone}`, limit: 10, ttlSeconds: 86400 },
    ];
    if (opts.ip !== undefined) rules.push({ key: `${p}:rl:ip:${opts.ip}`, limit: 30, ttlSeconds: 3600 });
    await this.rateLimit.hit(rules);

    const key = this.otpKey(scope, tenant.id, phone);
    const code = this.generateCode();

    // Yangi kod eskisini almashtiradi
    await this.redis
      .multi()
      .del(key)
      .hset(key, 'h', this.hmac(scope, tenant.id, phone, code).toString('hex'), 'attempts', 0)
      .expire(key, this.cfg.otpTtlSeconds)
      .exec();

    if (!this.cfg.otpDevMode || opts.alwaysDeliver) {
      try {
        await Promise.race([
          opts.deliver(code),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Code delivery timeout')), SEND_TIMEOUT_MS).unref(),
          ),
        ]);
      } catch (err) {
        await this.redis.del(key);
        await this.rateLimit.rollback(rules);
        throw new CustomerAuthException(opts.unavailableCode ?? 'sms_unavailable', 'Code delivery unavailable');
      }
    }

    return this.cfg.otpCooldownSeconds;
  }

  /**
   * Kodni tekshiradi. Muvaffaqiyatli bo'lsa kalit o'chiriladi (bir martalik).
   * Natija: 'ok'. Aks holda CustomerAuthException; 'locked' holatni ham `onLocked` orqali bildiradi.
   */
  async consume(
    tenantId: string,
    phone: string,
    code: string,
    hooks: { onFailed: () => Promise<void>; onLocked: () => Promise<void> },
    scope: OtpScope = 'customer',
  ): Promise<void> {
    const key = this.otpKey(scope, tenantId, phone);
    const res = (await this.redis.eval(BUMP_LUA, 1, key)) as [string, number] | null;
    if (!res) throw new CustomerAuthException('code_expired');

    const [storedHex, attempts] = res;
    const expected = Buffer.from(storedHex, 'hex');
    const given = this.hmac(scope, tenantId, phone, code);
    const equal = expected.length === given.length && timingSafeEqual(expected, given);

    if (equal) {
      // DEL faqat bitta parallel so'rov uchun 1 qaytaradi -> kod faqat bir marta ishlaydi
      const removed = await this.redis.del(key);
      if (removed !== 1) throw new CustomerAuthException('code_expired');
      return;
    }

    if (attempts >= this.cfg.otpMaxAttempts) {
      await this.redis.del(key);
      await hooks.onLocked();
      throw new CustomerAuthException('too_many_attempts');
    }
    await hooks.onFailed();
    throw new CustomerAuthException('invalid_code');
  }
}
