import type Redis from 'ioredis';
import { FakeRedis } from 'src/infra/redis/redis.fake';
import type { SmsProvider } from 'src/modules/sms/providers/sms-provider.interface';
import type { CustomerAuthConfig } from '../customer-auth.config';
import { CustomerAuthException } from '../errors/customer-auth.exception';
import { CustomerOtpService } from './customer-otp.service';
import { RateLimitService } from './rate-limit.service';

const PHONE = '+998901234567';
const IP = '10.0.0.1';
const TENANT = { id: 'tenant-a', brandName: 'Mant' };
const STAFF = { id: 'staff', brandName: 'Xmenu' };

const cfg = {
  otpHmacSecret: 'test-hmac-secret',
  otpLength: 6,
  otpTtlSeconds: 300,
  otpMaxAttempts: 5,
  otpCooldownSeconds: 60,
  otpDevMode: false,
  smsLocale: 'ru',
} as CustomerAuthConfig;

class FakeSms implements SmsProvider {
  sent: { phone: string; text: string }[] = [];
  failNext = false;
  async send(phone: string, text: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('provider down');
    }
    this.sent.push({ phone, text });
  }
  lastCode(): string {
    const m = this.sent[this.sent.length - 1]?.text.match(/\d{6}/);
    if (!m) throw new Error('no code sent');
    return m[0];
  }
}

const noopHooks = () => ({
  onFailed: jest.fn(async () => undefined),
  onLocked: jest.fn(async () => undefined),
});

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(CustomerAuthException);
  await p.catch((e: CustomerAuthException) => expect(e.code).toBe(code));
}

describe('CustomerOtpService', () => {
  let redis: FakeRedis;
  let sms: FakeSms;
  let otp: CustomerOtpService;

  beforeEach(() => {
    redis = new FakeRedis();
    sms = new FakeSms();
    const r = redis as unknown as Redis;
    otp = new CustomerOtpService(r, cfg, sms, new RateLimitService(r));
  });

  it('sends a random 6-digit code by SMS and stores only its hash', async () => {
    const random = jest.spyOn(Math, 'random');
    const resendAfter = await otp.request(STAFF, PHONE, IP, 'staff');

    expect(resendAfter).toBe(60);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();

    const code = sms.lastCode();
    expect(sms.sent[0].text).toBe(`Код подтверждения Xmenu: ${code}. Никому не сообщайте.`);
    const stored = await redis.hget(`sotp:staff:${PHONE}`, 'h');
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    for (const k of redis.keys()) {
      expect(String(await redis.get(k).catch(() => ''))).not.toContain(code);
    }
  });

  it('accepts the right code once', async () => {
    await otp.request(STAFF, PHONE, IP, 'staff');
    const code = sms.lastCode();
    await expect(otp.consume(STAFF.id, PHONE, code, noopHooks(), 'staff')).resolves.toBeUndefined();
    await expectCode(otp.consume(STAFF.id, PHONE, code, noopHooks(), 'staff'), 'code_expired');
  });

  it('rejects a wrong code and locks after the attempt limit', async () => {
    await otp.request(STAFF, PHONE, IP, 'staff');
    const code = sms.lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    const hooks = noopHooks();

    for (let i = 0; i < cfg.otpMaxAttempts - 1; i++) {
      await expectCode(otp.consume(STAFF.id, PHONE, wrong, hooks, 'staff'), 'invalid_code');
    }
    expect(hooks.onFailed).toHaveBeenCalledTimes(cfg.otpMaxAttempts - 1);

    await expectCode(otp.consume(STAFF.id, PHONE, wrong, hooks, 'staff'), 'too_many_attempts');
    expect(hooks.onLocked).toHaveBeenCalledTimes(1);
    // The code is gone: even the right one no longer works
    await expectCode(otp.consume(STAFF.id, PHONE, code, hooks, 'staff'), 'code_expired');
  });

  it('expires the code after the TTL', async () => {
    await otp.request(STAFF, PHONE, IP, 'staff');
    const code = sms.lastCode();
    redis.advance(cfg.otpTtlSeconds);
    await expectCode(otp.consume(STAFF.id, PHONE, code, noopHooks(), 'staff'), 'code_expired');
  });

  it('enforces the resend cooldown', async () => {
    await otp.request(STAFF, PHONE, IP, 'staff');
    const p = otp.request(STAFF, PHONE, IP, 'staff');
    await expectCode(p, 'rate_limited');
    await p.catch((e: CustomerAuthException) => expect(e.retryAfter).toBe(60));

    redis.advance(60);
    await expect(otp.request(STAFF, PHONE, IP, 'staff')).resolves.toBe(60);
  });

  it('allows at most 5 sends per hour per phone', async () => {
    for (let i = 0; i < 5; i++) {
      await otp.request(STAFF, PHONE, IP, 'staff');
      redis.advance(60);
    }
    await expectCode(otp.request(STAFF, PHONE, IP, 'staff'), 'rate_limited');
  });

  it('allows at most 30 sends per hour per IP', async () => {
    for (let i = 0; i < 30; i++) {
      await otp.request(STAFF, `+9989012345${String(i).padStart(2, '0')}`, IP, 'staff');
    }
    await expectCode(otp.request(STAFF, '+998909999999', IP, 'staff'), 'rate_limited');
  });

  it('keeps staff and customer codes and limits apart', async () => {
    await otp.request(TENANT, PHONE, IP);
    const customerCode = sms.lastCode();
    // Customer cooldown does not block the staff code
    await otp.request(STAFF, PHONE, IP, 'staff');
    const staffCode = sms.lastCode();

    if (customerCode !== staffCode) {
      await expectCode(otp.consume(STAFF.id, PHONE, customerCode, noopHooks(), 'staff'), 'invalid_code');
    }
    await expect(otp.consume(TENANT.id, PHONE, customerCode, noopHooks())).resolves.toBeUndefined();
    await expect(otp.consume(STAFF.id, PHONE, staffCode, noopHooks(), 'staff')).resolves.toBeUndefined();
  });

  it('rolls back the limits when the SMS provider fails', async () => {
    sms.failNext = true;
    await expectCode(otp.request(STAFF, PHONE, IP, 'staff'), 'sms_unavailable');
    expect(await redis.exists(`sotp:staff:${PHONE}`)).toBe(0);
    // No cooldown was consumed
    await expect(otp.request(STAFF, PHONE, IP, 'staff')).resolves.toBe(60);
  });

  it('validates the code format against OTP_LENGTH', () => {
    expect(otp.isValidCodeFormat('123456')).toBe(true);
    expect(otp.isValidCodeFormat('1234')).toBe(false);
    expect(otp.isValidCodeFormat(123456)).toBe(false);
  });
});
