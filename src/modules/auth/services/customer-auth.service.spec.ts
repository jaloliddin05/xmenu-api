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
