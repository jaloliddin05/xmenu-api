export const PHONE_REGEX = /^\+998\d{9}$/;

export function isValidPhone(phone: unknown): phone is string {
  return typeof phone === 'string' && PHONE_REGEX.test(phone);
}

/** +998901234567 -> +99890***4567 (loglar uchun) */
export function maskPhone(phone?: string | null): string | null {
  if (!phone) return null;
  if (phone.length < 10) return '***';
  return `${phone.slice(0, 6)}***${phone.slice(-4)}`;
}

/**
 * Ismni tekshiradi va normallashtiradi.
 * - boshqaruv belgilari (\n, \t, ...) va ko'rinmas formatlash belgilari bo'lsa -> null
 * - chekkadagi bo'shliqlar olinadi, ketma-ket bo'shliqlar bitta bo'ladi
 * - uzunlik 2..50 (Unicode kod nuqtalari bo'yicha)
 */
export function normalizeCustomerName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(raw)) return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  const length = Array.from(name).length;
  if (length < 2 || length > 50) return null;
  return name;
}
