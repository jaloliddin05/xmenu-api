import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { ENV_SCHEMA, featureStatus, validateEnv } from './env-schema';
import { checkEnvAtStartup } from './startup-check';

const KEY = 'a'.repeat(64);
const secret = (c: string) => c.repeat(40);

/** A production environment that passes every rule. */
const prodOk = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/xmenu',
  REDIS_URL: 'redis://localhost:6379',
  JWT_CUSTOMER_ACCESS_SECRET: secret('a'),
  JWT_CUSTOMER_REGISTRATION_SECRET: secret('b'),
  OTP_HMAC_SECRET: secret('c'),
  JWT_ACCESS_TOKEN_SECRET: secret('d'),
  SMS_PROVIDER: 'eskiz',
  ESKIZ_EMAIL: 'ops@xmenu.uz',
  ESKIZ_PASSWORD: 'p',
  PUBLIC_API_URL: 'https://api.xmenu.uz',
  DELIVERY_URL_TEMPLATE: 'https://{slug}.xmenu.uz',
  PLATFORM_DOMAIN: 'xmenu.uz',
  PAYMENT_CONFIG_KEY: KEY,
  OPENAI_API_KEY: 'k',
  NEXT_PUBLIC_URL: 'http://127.0.0.1:3001',
  REVALIDATE_SECRET: 'q',
  CLIENT_REVALIDATE_URL: 'http://127.0.0.1:3002/api/revalidate',
  CLIENT_REVALIDATE_SECRET: 'c',
  TELEGRAM_BOT_TOKEN: 't',
};

/** The smallest development environment that starts. */
const devMin = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/xmenu',
  JWT_CUSTOMER_ACCESS_SECRET: 'a',
  JWT_CUSTOMER_REGISTRATION_SECRET: 'b',
  OTP_HMAC_SECRET: 'c',
};

const off = (env: Record<string, string>) =>
  Object.fromEntries(
    featureStatus(env)
      .filter((f) => !f.enabled)
      .map((f) => [f.feature, f.reason]),
  );

describe('validateEnv', () => {
  it('accepts a complete production environment with every feature on', () => {
    const report = validateEnv(prodOk);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.features.every((f) => f.enabled)).toBe(true);
  });

  it.each([
    ['PUBLIC_API_URL', 'http://api.xmenu.uz', /https URL/],
    ['DELIVERY_URL_TEMPLATE', 'http://{slug}.xmenu.uz', /https URL/],
    ['DELIVERY_URL_TEMPLATE', 'https://menu.xmenu.uz', /\{slug\}/],
    ['PUBLIC_FILES_URL', 'http://files.xmenu.uz', /https URL/],
    ['PAYMENT_CONFIG_KEY', 'short', /32 bytes/],
    ['PLATFORM_DOMAIN', 'https://xmenu.uz', /host name/],
    ['SMS_PROVIDER', 'console', /not allowed/],
    ['OTP_DEV_MODE', 'true', /OTP_DEV_MODE/],
    ['DOMAIN_VERIFY_SKIP', 'true', /DOMAIN_VERIFY_SKIP/],
    ['TELEGRAM_API_BASE_URL', 'http://fake:1', /TELEGRAM_API_BASE_URL/],
    ['JWT_CUSTOMER_ACCESS_SECRET', 'short', /32 characters/],
    ['REVALIDATE_SECRET', '', /REVALIDATE_SECRET/],
  ])('production refuses %s=%s', (name, value, error) => {
    const report = validateEnv({ ...prodOk, [name]: value });
    expect(report.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(error)]),
    );
  });

  it.each([
    'PUBLIC_API_URL',
    'DELIVERY_URL_TEMPLATE',
    'PAYMENT_CONFIG_KEY',
    'JWT_ACCESS_TOKEN_SECRET',
    'ESKIZ_PASSWORD',
  ])('production requires %s', (name) => {
    const env: Record<string, string> = { ...prodOk };
    delete env[name];
    expect(validateEnv(env).errors).not.toEqual([]);
  });

  it('development starts with the minimum and lists what is off and why', () => {
    const report = validateEnv(devMin);
    expect(report.errors).toEqual([]);
    expect(off(devMin)).toMatchObject({
      telegram_bot: expect.stringContaining('PAYMENT_CONFIG_KEY'),
      delivery_link: 'DELIVERY_URL_TEMPLATE is not set',
      domains: expect.stringContaining('PLATFORM_DOMAIN'),
      payments: expect.stringContaining('PUBLIC_API_URL is not https'),
      translation: 'OPENAI_API_KEY is not set',
    });
    // console needs nothing outside production
    expect(off(devMin).sms).toBeUndefined();
  });

  it('development turns production-only rules into warnings or disabled features', () => {
    const env = {
      ...devMin,
      PUBLIC_API_URL: 'http://localhost:3000',
      DELIVERY_URL_TEMPLATE: 'http://{slug}.localhost:3002',
      OTP_DEV_MODE: 'true',
      SMS_PROVIDER: 'telegram',
    };
    const report = validateEnv(env);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('OTP_DEV_MODE')]),
    );
    expect(off(env)).toMatchObject({
      telegram_bot: expect.stringContaining('PUBLIC_API_URL is not https'),
      delivery_link: 'DELIVERY_URL_TEMPLATE is not https',
      sms: expect.stringContaining('OTP_DEV_MODE'),
    });
  });

  it.each([
    ['OTP_LENGTH', 'six', /integer/],
    ['HTTP_MAX_REDIRECTS', '-1', /integer >= 0/],
    ['OTP_DEV_MODE', 'yes', /true or false/],
    ['ORDER_QUEUES', 'no', /one of/],
    ['DATABASE_URL', 'mysql://x', /postgresql/],
    ['PUBLIC_API_URL', 'not a url', /must be a URL/],
    ['TELEGRAM_API_BASE_URL', 'ftp://fake', /http\(s\)/],
    ['SMS_PROVIDER', 'pigeon', /SMS_PROVIDER/],
  ])(
    'development still refuses an unusable value: %s=%s',
    (name, value, error) => {
      expect(validateEnv({ ...devMin, [name]: value }).errors).toEqual(
        expect.arrayContaining([expect.stringMatching(error)]),
      );
    },
  );

  it('requires the customer secrets everywhere, distinct from each other and the staff one', () => {
    const env: Record<string, string> = { ...devMin };
    delete env.OTP_HMAC_SECRET;
    expect(validateEnv(env).errors).toEqual([
      expect.stringContaining('OTP_HMAC_SECRET'),
    ]);
    expect(
      validateEnv({ ...devMin, JWT_CUSTOMER_REGISTRATION_SECRET: 'a' }).errors,
    ).toEqual([expect.stringContaining('must differ')]);
    expect(
      validateEnv({ ...devMin, JWT_ACCESS_TOKEN_SECRET: 'a' }).errors,
    ).toEqual([expect.stringContaining('JWT_ACCESS_TOKEN_SECRET')]);
  });

  it('never prints a value', () => {
    const value = 'leaked-secret-value-123';
    const report = validateEnv({
      ...prodOk,
      JWT_CUSTOMER_ACCESS_SECRET: value,
      PAYMENT_CONFIG_KEY: value,
      OTP_LENGTH: value,
      PUBLIC_API_URL: `http://${value}`,
    });
    expect(report.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain(value);
  });
});

describe('checkEnvAtStartup', () => {
  const logger = () => ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() });

  it('throws in production on an error and logs it', () => {
    const log = logger();
    expect(() =>
      checkEnvAtStartup({ ...prodOk, PUBLIC_API_URL: 'http://api' }, log),
    ).toThrow(/Configuration check failed/);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('PUBLIC_API_URL'),
    );
  });

  it('starts in development and prints the disabled features', () => {
    const log = logger();
    expect(() => checkEnvAtStartup(devMin, log)).not.toThrow();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'delivery_link: DELIVERY_URL_TEMPLATE is not set',
      ),
    );
  });
});

describe('ENV_SCHEMA covers the code and .env.example', () => {
  const root = join(__dirname, '..', '..', '..');
  const names = new Set(ENV_SCHEMA.map((s) => s.name));

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return sources(p);
      return /\.ts$/.test(f) && !/\.(spec|fake)\.ts$/.test(f) ? [p] : [];
    });
  }

  it('every variable the code reads is in the schema', () => {
    const read = new Set<string>();
    const patterns = [
      /\b(?:process\.)?env\.([A-Z][A-Z0-9_]+)/g,
      /process\.env\[['"]([A-Z][A-Z0-9_]+)['"]\]/g,
      /\b(?:int|configService\.get)\(\s*'([A-Z][A-Z0-9_]+)'/g,
    ];
    for (const file of sources(join(root, 'src'))) {
      const text = readFileSync(file, 'utf-8');
      for (const re of patterns)
        for (const m of text.matchAll(re)) read.add(m[1]);
    }
    expect([...read].filter((n) => !names.has(n)).sort()).toEqual([]);
  });

  it('every schema variable is documented in .env.example', () => {
    const example = readFileSync(join(root, '.env.example'), 'utf-8');
    const documented = new Set(
      [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]),
    );
    expect([...names].filter((n) => !documented.has(n)).sort()).toEqual([]);
  });
});
