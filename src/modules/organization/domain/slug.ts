import { randomInt } from 'crypto';
import { UUID_RE } from 'src/modules/tenant/tenant-key';

/**
 * Public slug of an organization (qr.xmenu.uz/{locale}/{slug}, {slug}.xmenu.uz): lower-case
 * latin letters and digits in dash-separated words, at most 63 chars, so it is also a valid DNS label.
 * The id, not the slug, identifies a tenant, so a UUID-shaped slug is refused to keep the two from
 * ever being confused.
 */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MIN = 3;
export const SLUG_MAX = 63;

/** Names the platform keeps for its own hosts ({name}.xmenu.uz) and for confusable addresses. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www',
  'api',
  'app',
  'qr',
  'order',
  'orders',
  'dashboard',
  'admin',
  'staging',
  'static',
  'assets',
  'cdn',
  'files',
  'mail',
  'smtp',
  'ftp',
  'ns1',
  'ns2',
  'support',
  'help',
  'status',
  'docs',
  'blog',
  'xmenu',
]);

export function isValidSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= SLUG_MIN &&
    value.length <= SLUG_MAX &&
    SLUG_RE.test(value) &&
    !UUID_RE.test(value) &&
    !RESERVED_SLUGS.has(value)
  );
}

export const SLUG_RULE = `${SLUG_MIN}-${SLUG_MAX} chars: a-z, 0-9 and single dashes between words; must not look like an id or be a name reserved by the platform`;

const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  // Uzbek cyrillic
  ў: 'o',
  қ: 'q',
  ғ: 'g',
  ҳ: 'h',
};
const UZBEK_ONLY = /[ўқғҳ]/;

/**
 * Cyrillic (Russian and Uzbek) to latin letters; other characters are kept for slugify to clean.
 * 'х' is 'kh' in Russian but 'x' in Uzbek, so a name with an Uzbek-only letter is read as Uzbek.
 */
export function transliterate(text: string): string {
  const lower = text.toLowerCase();
  const table = UZBEK_ONLY.test(lower) ? { ...CYRILLIC, х: 'x' } : CYRILLIC;
  return [...lower].map((ch) => table[ch] ?? (ch === '№' ? '' : ch)).join('');
}

/** Slug proposed from a venue name; names that leave no valid slug get a random one. */
export function slugify(name: string, maxLength = SLUG_MAX): string {
  const slug = transliterate(name)
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
