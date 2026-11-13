import { Logger } from '@nestjs/common';
import { OrganizationTypeEnum } from 'src/modules/organization/models/organization.model';
import {
  CustomerAuthConfig,
  DEFAULT_OTP_RATE_LIMITS,
  loadCustomerAuthConfig,
} from '../customer-auth.config';
import { makeStaffAuthDeps } from './staff-auth.fake';
import { StaffAuthService } from './staff-auth.service';

// Dozens of sign-ups per test: the limits are under test, not bcrypt
jest.mock('src/infra/helper/auth/hash-password', () => ({
  hashPassword: async (p: string) => `hash:${p}`,
}));

const ENV_KEYS = [
  'OTP_PHONE_HOURLY_LIMIT',
  'OTP_PHONE_DAILY_LIMIT',
  'OTP_IP_HOURLY_LIMIT',
  'STAFF_REGISTER_IP_HOURLY_LIMIT',
];
const SECRETS = {
  JWT_CUSTOMER_ACCESS_SECRET: 'a'.repeat(40),
  JWT_CUSTOMER_REGISTRATION_SECRET: 'b'.repeat(40),
  OTP_HMAC_SECRET: 'c'.repeat(40),
};
const CTX = { ip: '203.0.113.5', userAgent: 'jest' };
const SIGNUP = {
  password: 'owner-password-1',
  name: 'Mant',
  type: OrganizationTypeEnum.Cafe,
  first_name: 'Aziz',
};

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});
beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

function configFromEnv(extra: Record<string, string> = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, SECRETS, extra);
  return loadCustomerAuthConfig();
}

function build(cfg: CustomerAuthConfig) {
  const deps = makeStaffAuthDeps(cfg);
  const auth = new StaffAuthService(
    deps.db as any,
    deps.organizations as any,
    deps.otp,
    deps.rateLimit,
    deps.events,
    deps.throttle,
    deps.sessions as any,
    deps.r,
    cfg,
  );
  return { deps, auth };
}

describe('code request limits', () => {
  it('default to the production values when the environment sets nothing', () => {
    expect(configFromEnv().otpRateLimits).toEqual({
      phoneHourly: 5,
      phoneDaily: 10,
      ipHourly: 30,
      registerIpHourly: 10,
    });
    expect(DEFAULT_OTP_RATE_LIMITS).toEqual(configFromEnv().otpRateLimits);
  });

  it('come from the environment, and a bad value falls back to the default', () => {
    const cfg = configFromEnv({
      OTP_PHONE_HOURLY_LIMIT: '500',
      OTP_PHONE_DAILY_LIMIT: '1000',
      OTP_IP_HOURLY_LIMIT: '5000',
      STAFF_REGISTER_IP_HOURLY_LIMIT: 'many',
    });
    expect(cfg.otpRateLimits).toEqual({
      phoneHourly: 500,
      phoneDaily: 1000,
      ipHourly: 5000,
      registerIpHourly: 10,
    });
  });

  describe('with the production values', () => {
    it('owner sign-ups: the 11th from one IP in an hour is refused', async () => {
      const { auth } = build(configFromEnv());
      for (let i = 0; i < 10; i++)
        await auth.register(
          { ...SIGNUP, phone: `+9989012345${String(i).padStart(2, '0')}` },
          CTX,
        );
      await expect(
        auth.register({ ...SIGNUP, phone: '+998909999999' }, CTX),
      ).rejects.toMatchObject({ code: 'rate_limited' });
    });

    it('one phone: 5 codes an hour (pause 60 s), the 6th is refused', async () => {
      const { deps, auth } = build(configFromEnv());
      for (let i = 0; i < 5; i++) {
        await auth.register(
          { ...SIGNUP, phone: '+998901111111' },
          { ...CTX, ip: `10.0.1.${i}` },
        );
        deps.redis.advance(61);
      }
      await expect(
        auth.register(
          { ...SIGNUP, phone: '+998901111111' },
          { ...CTX, ip: '10.0.2.1' },
        ),
      ).rejects.toMatchObject({ code: 'rate_limited' });
    });

    it('one phone: 10 codes a day, the 11th is refused', async () => {
      const { deps, auth } = build(configFromEnv());
      for (let i = 0; i < 10; i++) {
        await auth.register(
          { ...SIGNUP, phone: '+998901111111' },
          { ...CTX, ip: `10.0.1.${i}` },
        );
        // 61 s pause, and an hour later so the hourly window of 5 does not decide
        deps.redis.advance(i % 5 === 4 ? 3601 : 61);
      }
      await expect(
        auth.register(
          { ...SIGNUP, phone: '+998901111111' },
          { ...CTX, ip: '10.0.2.1' },
        ),
      ).rejects.toMatchObject({ code: 'rate_limited' });
    });

    it('codes from one IP: the 31st in an hour is refused, over many phones', async () => {
      const cfg = {
        ...configFromEnv(),
        otpRateLimits: {
          ...configFromEnv().otpRateLimits,
          registerIpHourly: 1000,
        },
      };
      const { auth } = build(cfg);
      for (let i = 0; i < 30; i++)
        await auth.register(
          { ...SIGNUP, phone: `+9989012345${String(i).padStart(2, '0')}` },
          CTX,
        );
      await expect(
        auth.register({ ...SIGNUP, phone: '+998909999999' }, CTX),
      ).rejects.toMatchObject({ code: 'rate_limited' });
    });
  });

  it('raised through the environment, the same traffic passes', async () => {
    const { auth } = build(
      configFromEnv({
        STAFF_REGISTER_IP_HOURLY_LIMIT: '100000',
        OTP_IP_HOURLY_LIMIT: '100000',
      }),
    );
    for (let i = 0; i < 40; i++)
      await auth.register(
        { ...SIGNUP, phone: `+9989010000${String(i).padStart(2, '0')}` },
        CTX,
      );
  });
});
