import type { CustomerAuthConfig } from '../customer-auth.config';
import { CustomerAuthService } from './customer-auth.service';

const TENANT = {
  id: '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
  slug: 'demo',
  brandName: 'Demo Cafe',
  defaultLanguage: 'ru' as const,
  languages: ['ru' as const],
  currency: 'UZS',
};
const CTX = { ip: '10.0.0.1', userAgent: 'jest' };

describe('CustomerAuthService.requestOtp', () => {
  function service(otpLength: number) {
    const otp = { request: jest.fn(async () => 60) };
    const events = { log: jest.fn(async () => undefined) };
    const none = null as any;
    return new CustomerAuthService(
      none,
      none,
      none,
      otp as any,
      none,
      none,
      events as any,
      none,
      none,
      none,
      { otpLength } as CustomerAuthConfig,
    );
  }

  it('tells the client how many digits to expect', async () => {
    await expect(
      service(6).requestOtp(TENANT, '+998901234567', CTX),
    ).resolves.toEqual({ resendAfter: 60, codeLength: 6 });
    await expect(
      service(4).requestOtp(TENANT, '+998901234567', CTX),
    ).resolves.toEqual({ resendAfter: 60, codeLength: 4 });
  });

  it('rejects a malformed phone before sending anything', async () => {
    const err = await service(6)
      .requestOtp(TENANT, '+7901', CTX)
      .catch((e) => e);
    expect(err.code).toBe('invalid_phone');
  });
});

describe('CustomerAuthService.completeVerifiedPhone', () => {
  const PHONE = '+998901234567';
  const CUSTOMER = { id: 'cust-1', phone: PHONE, status: 'active' };

  function service(opts: { existing?: object | null; telegramOwner?: object | null } = {}) {
    const customers = {
      findByPhone: jest.fn(async () =>
        opts.existing === undefined ? CUSTOMER : opts.existing,
      ),
      findByTelegramId: jest.fn(async () => opts.telegramOwner ?? null),
      update: jest.fn(async () => undefined),
    };
    const tx = { customer: { update: jest.fn(async () => undefined) } };
    const prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
    const sessions = {
      createSession: jest.fn(async () => ({ accessToken: 'a', refreshToken: 'r' })),
    };
    const tokens = { signRegistration: jest.fn(() => 'reg-token') };
    const customerService = { toUser: jest.fn((c: any) => ({ id: c.id })) };
    const telegram = { verifyForTenant: jest.fn() };
    const events = { log: jest.fn(async () => undefined) };
    const none = null as any;
    const svc = new CustomerAuthService(
      prisma as any,
      customers as any,
      customerService as any,
      none,
      sessions as any,
      tokens as any,
      events as any,
      none,
      telegram as any,
      none,
      {} as CustomerAuthConfig,
    );
    return { svc, customers, telegram, tokens };
  }

  it('a new phone gets a registration token and nothing is created', async () => {
    const { svc, customers, tokens } = service({ existing: null });
    await expect(
      svc.completeVerifiedPhone(TENANT, PHONE, CTX, { telegramId: '555' }),
    ).resolves.toEqual({ isNewUser: true, registrationToken: 'reg-token' });
    expect(tokens.signRegistration).toHaveBeenCalledWith(PHONE, TENANT.id);
    expect(customers.update).not.toHaveBeenCalled();
  });

  it('links the Telegram user proven by the bot without re-checking initData', async () => {
    const { svc, customers, telegram } = service();
    const result = await svc.completeVerifiedPhone(TENANT, PHONE, CTX, {
      telegramId: '555',
    });
    expect(result).toMatchObject({ isNewUser: false, user: { id: 'cust-1' } });
    expect(telegram.verifyForTenant).not.toHaveBeenCalled();
    expect(customers.update).toHaveBeenCalledWith(TENANT.id, 'cust-1', {
      telegram_id: '555',
    });
  });

  it('does not take a Telegram id that already belongs to a customer', async () => {
    const { svc, customers } = service({ telegramOwner: { id: 'other' } });
    await svc.completeVerifiedPhone(TENANT, PHONE, CTX, { telegramId: '555' });
    expect(customers.update).not.toHaveBeenCalled();
  });
});
