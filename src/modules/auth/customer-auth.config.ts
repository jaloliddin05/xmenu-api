import { Logger } from '@nestjs/common';

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
}

function int(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} musbat butun son bo'lishi kerak (hozir: "${raw}")`);
  }
  return n;
}

function secret(name: string, isProd: boolean): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} env o'zgaruvchisi majburiy (mijoz autentifikatsiyasi uchun)`);
  }
  if (isProd && v.length < 32) {
    throw new Error(`${name} production'da kamida 32 belgi bo'lishi kerak`);
  }
  return v;
}

export function loadCustomerAuthConfig(): CustomerAuthConfig {
  const isProd = process.env.NODE_ENV === 'production';
  const otpDevMode = process.env.OTP_DEV_MODE === 'true';

  if (otpDevMode && isProd) {
    throw new Error('OTP_DEV_MODE=true bilan NODE_ENV=production da ishga tushmaydi');
  }
  if (otpDevMode) {
    new Logger('CustomerAuthConfig').warn(
      'OTP_DEV_MODE yoqilgan: SMS yuborilmaydi, kod har doim 1234... bo\'ladi',
    );
  }

  const accessSecret = secret('JWT_CUSTOMER_ACCESS_SECRET', isProd);
  const registrationSecret = secret('JWT_CUSTOMER_REGISTRATION_SECRET', isProd);
  const otpHmacSecret = secret('OTP_HMAC_SECRET', isProd);

  if (accessSecret === registrationSecret) {
    throw new Error('JWT_CUSTOMER_ACCESS_SECRET va JWT_CUSTOMER_REGISTRATION_SECRET har xil bo\'lishi kerak');
  }
  const staffSecrets = [
    process.env.JWT_ACCESS_TOKEN_SECRET,
    process.env.JWT_REFRESH_TOKEN_SECRET,
  ].filter(Boolean);
  if (staffSecrets.includes(accessSecret) || staffSecrets.includes(registrationSecret)) {
    throw new Error('Mijoz JWT secretlari xodimlar (user) secretlaridan farq qilishi kerak');
  }

  const locale = process.env.SMS_LOCALE === 'ru' ? 'ru' : 'uz';

  return {
    accessSecret,
    registrationSecret,
    otpHmacSecret,
    otpLength: int('OTP_LENGTH', 4),
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
    telegramInitDataMaxAgeSeconds: int('TELEGRAM_INITDATA_MAX_AGE_SECONDS', 86400),
  };
}
