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

const SMS_TEXT = {
  uz: (brand: string, code: string) => `${brand} ga kirish uchun kod: ${code}. Hech kimga bermang.`,
  ru: (brand: string, code: string) => `Код для входа в ${brand}: ${code}. Никому не сообщайте.`,
};

@Injectable()
export class CustomerOtpService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CUSTOMER_AUTH_CONFIG) private readonly cfg: CustomerAuthConfig,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly rateLimit: RateLimitService,
  ) {}

  private otpKey(tenantId: string, phone: string) {
    return `otp:${tenantId}:${phone}`;
  }

  private hmac(tenantId: string, phone: string, code: string): Buffer {
    return createHmac('sha256', this.cfg.otpHmacSecret)
      .update(`${tenantId}:${phone}:${code}`)
      .digest();
  }

  private generateCode(): string {
    if (this.cfg.otpDevMode) return '1234567890'.slice(0, this.cfg.otpLength);
    return randomInt(0, 10 ** this.cfg.otpLength).toString().padStart(this.cfg.otpLength, '0');
  }

  isValidCodeFormat(code: unknown): code is string {
    return typeof code === 'string' && new RegExp(`^\\d{${this.cfg.otpLength}}$`).test(code);
  }

  /** otp/request: customers jadvaliga umuman tegmaydi. Qaytaradi: resendAfter (sekund). */
  async request(tenant: { id: string; brandName: string }, phone: string, ip: string): Promise<number> {
    // Telefon bo'yicha kalitlarda tenant YO'Q (tenant klientdan keladi — aylanib o'tib bo'lmasin)
    const rules: RateRule[] = [
      { key: `otp:cd:${phone}`, limit: 1, ttlSeconds: this.cfg.otpCooldownSeconds },
      { key: `otp:rl:phone:h:${phone}`, limit: 5, ttlSeconds: 3600 },
      { key: `otp:rl:phone:d:${phone}`, limit: 10, ttlSeconds: 86400 },
      { key: `otp:rl:ip:${ip}`, limit: 30, ttlSeconds: 3600 },
    ];
    await this.rateLimit.hit(rules);

    const key = this.otpKey(tenant.id, phone);
    const code = this.generateCode();

    // Yangi kod eskisini almashtiradi
    await this.redis
      .multi()
      .del(key)
      .hset(key, 'h', this.hmac(tenant.id, phone, code).toString('hex'), 'attempts', 0)
      .expire(key, this.cfg.otpTtlSeconds)
      .exec();

    if (!this.cfg.otpDevMode) {
      try {
        await Promise.race([
          this.sms.send(phone, SMS_TEXT[this.cfg.smsLocale](tenant.brandName, code)),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('SMS provider timeout')), SEND_TIMEOUT_MS).unref(),
          ),
        ]);
      } catch (err) {
        await this.redis.del(key);
        await this.rateLimit.rollback(rules);
        throw new CustomerAuthException('sms_unavailable', 'SMS provider unavailable');
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
  ): Promise<void> {
    const key = this.otpKey(tenantId, phone);
    const res = (await this.redis.eval(BUMP_LUA, 1, key)) as [string, number] | null;
    if (!res) throw new CustomerAuthException('code_expired');

    const [storedHex, attempts] = res;
    const expected = Buffer.from(storedHex, 'hex');
    const given = this.hmac(tenantId, phone, code);
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
