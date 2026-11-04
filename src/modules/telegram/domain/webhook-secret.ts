import { createHash, timingSafeEqual } from 'crypto';

/**
 * The webhook secret_token is a random 256-bit value only Telegram and the stored hash know about:
 * the database keeps sha256 (hex), so a leaked dump cannot forge updates. A plain hash is enough
 * for a random secret of that size; a slow password hash would only cost time on every update.
 */
export function hashWebhookSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Constant-time check of the X-Telegram-Bot-Api-Secret-Token header against the stored hash. */
export function webhookSecretMatches(
  header: string | undefined,
  storedHash: string,
): boolean {
  if (!header) return false;
  const given = createHash('sha256').update(header, 'utf8').digest();
  const expected = Buffer.from(storedHash, 'hex');
  return expected.length === given.length && timingSafeEqual(given, expected);
}
