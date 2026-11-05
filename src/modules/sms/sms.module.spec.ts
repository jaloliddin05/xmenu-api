import {
  isSmsConfigured,
  resolveSmsProviderName,
  smsEnvIssues,
} from './sms.module';

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

  it('needs the OTP group bot and chat when telegram is the provider', () => {
    const env = { NODE_ENV: 'development', SMS_PROVIDER: 'telegram' };
    expect(isSmsConfigured(env)).toBe(false);
    expect(isSmsConfigured({ ...env, OTP_BOT: '1:T' })).toBe(false);
    expect(isSmsConfigured({ ...env, XMENU_CHAT_ID: '-100' })).toBe(false);
    expect(
      isSmsConfigured({ ...env, OTP_BOT: '1:T', XMENU_CHAT_ID: '-100' }),
    ).toBe(true);
    expect(
      isSmsConfigured({
        NODE_ENV: 'production',
        SMS_PROVIDER: 'telegram',
        OTP_BOT: '1:T',
        XMENU_CHAT_ID: '-100',
      }),
    ).toBe(true);
  });

  it('console needs nothing outside production, and is never configured in production', () => {
    expect(
      isSmsConfigured({ NODE_ENV: 'development', SMS_PROVIDER: 'console' }),
    ).toBe(true);
    // The default provider outside production
    expect(isSmsConfigured({ NODE_ENV: 'development' })).toBe(true);
    expect(isSmsConfigured({ NODE_ENV: 'test' })).toBe(true);
    expect(
      isSmsConfigured({ NODE_ENV: 'production', SMS_PROVIDER: 'console' }),
    ).toBe(false);
  });

  it('production without SMS_PROVIDER means Eskiz', () => {
    expect(isSmsConfigured({ NODE_ENV: 'production' })).toBe(false);
    expect(
      isSmsConfigured({
        NODE_ENV: 'production',
        ESKIZ_EMAIL: 'a@b.uz',
        ESKIZ_PASSWORD: 'x',
      }),
    ).toBe(true);
  });
});

describe('smsEnvIssues', () => {
  it('rejects an unknown provider and console in production', () => {
    expect(smsEnvIssues({ SMS_PROVIDER: 'pigeon' }).errors).toEqual([
      expect.stringContaining('SMS_PROVIDER'),
    ]);
    expect(
      smsEnvIssues({ NODE_ENV: 'production', SMS_PROVIDER: 'console' }).errors,
    ).toEqual([expect.stringContaining('not allowed')]);
  });

  it('production needs the credentials of the chosen provider', () => {
    expect(smsEnvIssues({ NODE_ENV: 'production' }).errors).toEqual([
      expect.stringContaining('ESKIZ_EMAIL'),
    ]);
    expect(
      smsEnvIssues({ NODE_ENV: 'production', SMS_PROVIDER: 'telegram' }).errors,
    ).toEqual([expect.stringContaining('OTP_BOT')]);
    expect(
      smsEnvIssues({
        NODE_ENV: 'production',
        ESKIZ_EMAIL: 'a@b.uz',
        ESKIZ_PASSWORD: 'p',
      }).errors,
    ).toEqual([]);
  });

  it('development without credentials is not an error (the feature is off)', () => {
    expect(
      smsEnvIssues({ NODE_ENV: 'development', SMS_PROVIDER: 'eskiz' }).errors,
    ).toEqual([]);
  });
});
