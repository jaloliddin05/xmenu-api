/** What an SMS says instead of a venue name it must not carry. */
export const SMS_BRAND_FALLBACK = 'Xmenu';
export const SMS_BRAND_MAX = 30;

// Letters of Latin and Cyrillic script (Uzbek ones included), digits, space, hyphen and apostrophes (o', oʻ, ’)
const NOT_ALLOWED = /[^\p{Script=Latin}\p{Script=Cyrillic}0-9 \-'ʻʼ’‘]/gu;
// A scheme, www. or a dot between a label and a word of 2+ letters (example.com, pay.me)
const LOOKS_LIKE_ADDRESS = /:\/\/|www\.|[\p{L}\p{N}-]\.\p{L}{2,}/iu;
// Phone-like: 7+ digits in a row once usual separators are dropped
const PHONE_LIKE = /\d{7,}/;

/**
 * The venue name as an SMS may carry it (phishing from the platform's sender, audit S-06): letters, digits, space,
 * hyphen and apostrophes only, at most SMS_BRAND_MAX characters. A name that looks like an address or a phone number,
 * or that is empty after cleaning, becomes SMS_BRAND_FALLBACK.
 */
export function smsBrand(name: string | null | undefined): string {
  const raw = (name ?? '').normalize('NFC');
  if (LOOKS_LIKE_ADDRESS.test(raw)) return SMS_BRAND_FALLBACK;
  if (PHONE_LIKE.test(raw.replace(/[\s\-()+./]/g, '')))
    return SMS_BRAND_FALLBACK;
  const clean = raw
    .replace(NOT_ALLOWED, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SMS_BRAND_MAX)
    .trim();
  return /[\p{L}\p{N}]/u.test(clean) ? clean : SMS_BRAND_FALLBACK;
}
