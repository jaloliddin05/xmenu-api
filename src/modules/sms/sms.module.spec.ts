import { isSmsConfigured, resolveSmsProviderName } from './sms.module';

describe('resolveSmsProviderName', () => {
  it('defaults to console outside production and eskiz in production', () => {
    expect(resolveSmsProviderName({ NODE_ENV: 'development' })).toBe('console');
    expect(resolveSmsProviderName({ NODE_ENV: 'production' })).toBe('eskiz');
  });

  it('refuses the console provider in production', () => {
    expect(() =>
      resolveSmsProviderName({
        NODE_ENV: 'production',
        SMS_PROVIDER: 'console',
      }),
    ).toThrow(/not allowed/);
  });

  it('keeps the telegram test provider available', () => {
    expect(
      resolveSmsProviderName({
        NODE_ENV: 'production',
        SMS_PROVIDER: 'telegram',
      }),
    ).toBe('telegram');
  });

  it('rejects unknown providers', () => {
    expect(() =>
      resolveSmsProviderName({ SMS_PROVIDER: 'carrier-pigeon' }),
    ).toThrow();
  });
});

describe('isSmsConfigured', () => {
  it('needs the Eskiz credentials when Eskiz is the provider', () => {
    const env = { NODE_ENV: 'production', SMS_PROVIDER: 'eskiz' };
    expect(isSmsConfigured(env)).toBe(false);
    expect(isSmsConfigured({ ...env, ESKIZ_EMAIL: 'a@b.uz' })).toBe(false);
    expect(
      isSmsConfigured({ ...env, ESKIZ_EMAIL: 'a@b.uz', ESKIZ_PASSWORD: 'x' }),
    ).toBe(true);
  });

  it('the telegram and console providers need nothing', () => {
    expect(isSmsConfigured({ SMS_PROVIDER: 'telegram' })).toBe(true);
    expect(isSmsConfigured({ SMS_PROVIDER: 'console' })).toBe(true);
  });
});
