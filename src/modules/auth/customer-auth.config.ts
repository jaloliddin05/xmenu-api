import { Env, EnvIssues, isProduction } from 'src/config/env/env-issues';

export const CUSTOMER_AUTH_CONFIG = 'CUSTOMER_AUTH_CONFIG';

export interface CustomerAuthConfig {
  accessSecret: string;
  registrationSecret: string;
  otpHmacSecret: string;

  otpLength: number;
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpCooldownSeconds: number;
  otpDevMode: boolean;

  accessTtlSeconds: number;
  registrationTtlSeconds: number;
  refreshTtlDays: number;
  sessionAbsoluteDays: number;
  refreshReuseLeewaySeconds: number;
  maxActiveFamilies: number;

  smsLocale: 'uz' | 'ru';
  telegramInitDataMaxAgeSeconds: number;
  /** Lifetime of a Telegram phone-verification session. */
  telegramVerifyTtlSeconds: number;
}

const CUSTOMER_SECRETS = [
  'JWT_CUSTOMER_ACCESS_SECRET',
  'JWT_CUSTOMER_REGISTRATION_SECRET',
  'OTP_HMAC_SECRET',
] as const;

/**
 * Startup check (validateEnv): the three customer secrets are required everywhere, at least 32
 * characters in production, distinct from each other and from the staff JWT secret; OTP_DEV_MODE is
 * refused in production and a warning elsewhere. Integer settings are checked by the env schema.
 */
export function customerAuthEnvIssues(env: Env = process.env): EnvIssues {
  const prod = isProduction(env);
  const issues: EnvIssues = { errors: [], warnings: [] };
  if (env.OTP_DEV_MODE === 'true') {
    if (prod)
      issues.errors.push(
        'OTP_DEV_MODE=true is not allowed when NODE_ENV=production',
      );
    else
      issues.warnings.push(
        'OTP_DEV_MODE=true: no codes are sent, every code is the fixed test code',
      );
  }
  for (const name of CUSTOMER_SECRETS) {
    const v = env[name];
    if (!v) issues.errors.push(`${name} is required (customer auth)`);
    else if (prod && v.length < 32)
      issues.errors.push(
        `${name} must be at least 32 characters when NODE_ENV=production`,
      );
  }
  const access = env.JWT_CUSTOMER_ACCESS_SECRET;
  const registration = env.JWT_CUSTOMER_REGISTRATION_SECRET;
  if (access && access === registration) {
    issues.errors.push(
      'JWT_CUSTOMER_ACCESS_SECRET and JWT_CUSTOMER_REGISTRATION_SECRET must differ',
    );
  }
  const staff = env.JWT_ACCESS_TOKEN_SECRET;
  if (staff && (staff === access || staff === registration)) {
    issues.errors.push(
      'Customer JWT secrets must differ from JWT_ACCESS_TOKEN_SECRET',
    );
  }
  return issues;
}

/** Positive integer setting; validateEnv rejects other values at startup, here they fall back. */
function int(name: string, def: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : def;
}

export function loadCustomerAuthConfig(): CustomerAuthConfig {
  // Also checked by validateEnv at startup; kept here so the module never builds with bad secrets
  const { errors } = customerAuthEnvIssues(process.env);
  if (errors.length) throw new Error(errors.join('; '));
  const otpDevMode = process.env.OTP_DEV_MODE === 'true';
  const accessSecret = process.env.JWT_CUSTOMER_ACCESS_SECRET!;
  const registrationSecret = process.env.JWT_CUSTOMER_REGISTRATION_SECRET!;
  const otpHmacSecret = process.env.OTP_HMAC_SECRET!;

  const locale = process.env.SMS_LOCALE === 'ru' ? 'ru' : 'uz';

  return {
    accessSecret,
    registrationSecret,
    otpHmacSecret,
    otpLength: int('OTP_LENGTH', 6),
    otpTtlSeconds: int('OTP_TTL_SECONDS', 300),
    otpMaxAttempts: int('OTP_MAX_ATTEMPTS', 5),
    otpCooldownSeconds: int('OTP_COOLDOWN_SECONDS', 60),
    otpDevMode,
    accessTtlSeconds: int('ACCESS_TTL_SECONDS', 900),
    registrationTtlSeconds: 600,
    refreshTtlDays: int('REFRESH_TTL_DAYS', 30),
    sessionAbsoluteDays: int('SESSION_ABSOLUTE_DAYS', 180),
    refreshReuseLeewaySeconds: int('REFRESH_REUSE_LEEWAY_SECONDS', 10),
    maxActiveFamilies: 10,
    smsLocale: locale,
    telegramInitDataMaxAgeSeconds: int(
      'TELEGRAM_INITDATA_MAX_AGE_SECONDS',
      86400,
    ),
    telegramVerifyTtlSeconds: int('TELEGRAM_VERIFY_TTL_SECONDS', 300),
  };
}
