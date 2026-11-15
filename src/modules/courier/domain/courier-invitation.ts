import { createHash, randomBytes } from 'crypto';

/**
 * One-time invitation of a courier to the venue bot: t.me/<bot>?start=c_<token>. The link lives 24 hours,
 * only the sha256 of the token is stored, a newer link voids the older ones (docs/DELIVERY.md, "Безопасность").
 * Telegram's start parameter allows up to 64 characters of [A-Za-z0-9_-]; `c_` + 43 base64url fits.
 */
export const COURIER_INVITE_PREFIX = 'c_';
export const COURIER_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The token from a /start payload, or null when the payload is not a courier invitation. */
export function inviteTokenFromStart(
  payload: string | undefined,
): string | null {
  if (!payload?.startsWith(COURIER_INVITE_PREFIX)) return null;
  const token = payload.slice(COURIER_INVITE_PREFIX.length);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function inviteLink(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${COURIER_INVITE_PREFIX}${token}`;
}

/** The invitation can still be used: not used, not revoked, not expired. */
export function inviteUsable(
  inv: { used_at: Date | null; revoked_at: Date | null; expires_at: Date },
  now: Date,
): boolean {
  return !inv.used_at && !inv.revoked_at && inv.expires_at > now;
}
