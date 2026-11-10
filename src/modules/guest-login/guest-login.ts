import { isSmsConfigured } from 'src/modules/sms/sms.module';

/**
 * How a customer of a venue can confirm a phone right now. sms depends on the platform only,
 * telegram on the venue's own bot (connected, enabled, token decrypts).
 */
export interface GuestLoginMethods {
  sms: boolean;
  telegram: boolean;
}

/**
 * Mirrors what POST /auth/customer/otp/request decides (customer-otp.service.ts): a configured SMS
 * provider, or OTP_DEV_MODE (codes in the log, never in production). A configuration check, not a ping.
 */
export function smsLoginAvailable(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.OTP_DEV_MODE === 'true' || isSmsConfigured(env);
}

export const hasGuestLogin = (m: GuestLoginMethods) => m.sms || m.telegram;
