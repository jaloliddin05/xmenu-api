import { randomInt } from 'crypto';
import { UUID_RE } from 'src/modules/tenant/tenant-key';

/**
 * Public slug of an organization (qr.xmenu.uz/{locale}/{slug}, order.xmenu.uz/{slug}): lower-case
 * latin letters and digits in dash-separated words. The id, not the slug, identifies a tenant, so a
 * UUID-shaped slug is refused to keep the two from ever being confused.
 */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MIN = 3;
export const SLUG_MAX = 63;

export function isValidSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= SLUG_MIN &&
    value.length <= SLUG_MAX &&
    SLUG_RE.test(value) &&
    !UUID_RE.test(value)
  );
}

export const SLUG_RULE = `${SLUG_MIN}-${SLUG_MAX} chars: a-z, 0-9 and single dashes between words; must not look like an id`;

/** Slug proposed from a venue name; names without latin letters or digits get a random one. */
export function slugify(name: string, maxLength = SLUG_MAX): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, maxLength)
    .replace(/^-+|-+$/g, '');
  return isValidSlug(slug) ? slug : randomSlug();
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function randomSlug(): string {
  let tail = '';
  for (let i = 0; i < 6; i++) tail += ALPHABET[randomInt(ALPHABET.length)];
  return `venue-${tail}`;
}
