import type { PosStreet } from '../provider/pos-provider';

/**
 * Street of the POS directory for a guest address written as one line (docs/IIKO.md, decision 8):
 * the line is split at commas, a part equal to a street name (exactly, then after normalizing) names
 * the street, and a house number next to it (in the same part or the next one) names the house. Only
 * one street may match; anything else is left to the operator.
 */

/** Words for the kind of street, dropped before comparing (ru, uz Latin and Cyrillic, en). */
const STREET_WORDS = new Set([
  'улица',
  'ул',
  'проспект',
  'пр-т',
  'просп',
  'пр',
  'переулок',
  'пер',
  'проезд',
  'шоссе',
  'бульвар',
  'б-р',
  'площадь',
  'пл',
  'тупик',
  'массив',
  'микрорайон',
  'мкр',
  'квартал',
  'кв-л',
  'кучаси',
  'кўчаси',
  'куча',
  'кўча',
  'шох',
  'шоҳ',
  'берк',
  'тор',
  'kochasi',
  'kucha',
  'kocha',
  'shoh',
  'berk',
  'tor',
  'mavzesi',
  'massivi',
  'mahallasi',
  'street',
  'st',
  'avenue',
  'ave',
  'prospekt',
  'prospekti',
]);

const HOUSE =
  /^(?:д|дом|uy|h|house)?\.?\s*(\d+[a-zа-яё]?(?:\/\d+[a-zа-яё]?)?)$/i;

/** Lowercase, ё → е, no apostrophes (oʻ, gʻ, ’), no street words, single spaces. */
export function normalizeStreet(name: string): string {
  return name
    .toLocaleLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[ʻʼ'‘’`]/g, '')
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STREET_WORDS.has(w))
    .join(' ');
}

const exact = (s: string) => s.trim().toLocaleLowerCase();

/** A house number: "10", "10а", "10/2", "д. 10", "uy 10". */
function house(part: string | undefined): string | null {
  const m = part?.trim().match(HOUSE);
  return m ? m[1] : null;
}

interface Candidate {
  text: string;
  house: string | null;
}

/** A part of the line as a street name, alone or followed by its house in the same part. */
function candidates(parts: string[], i: number): Candidate[] {
  const out: Candidate[] = [{ text: parts[i], house: house(parts[i + 1]) }];
  const words = parts[i].trim().split(/\s+/);
  const last = house(words[words.length - 1]);
  if (words.length > 1 && last)
    out.push({ text: words.slice(0, -1).join(' '), house: last });
  return out;
}

function pick(
  streets: PosStreet[],
  parts: string[],
  same: (street: PosStreet, text: string) => boolean,
): { street: PosStreet; house: string | null } | 'ambiguous' | null {
  let street: PosStreet | null = null;
  let house: string | null = null;
  const cities = new Set(parts.map((p) => normalizeStreet(p)));
  for (let i = 0; i < parts.length; i++)
    for (const c of candidates(parts, i)) {
      let hits = streets.filter((s) => same(s, c.text));
      // The same street name in several cities: the city named in the address decides
      if (hits.length > 1)
        hits = hits.filter((s) => cities.has(normalizeStreet(s.city)));
      if (hits.length > 1) return 'ambiguous';
      if (!hits.length) continue;
      if (street && street.id !== hits[0].id) return 'ambiguous';
      street = hits[0];
      house = house ?? c.house;
    }
  return street ? { street, house } : null;
}

export function matchStreet(
  line: string | null | undefined,
  streets: PosStreet[],
): { streetId: string; house: string } | null {
  const parts = (line ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length || !streets.length) return null;
  let found = pick(streets, parts, (s, text) => exact(s.name) === exact(text));
  if (!found) {
    found = pick(streets, parts, (s, text) => {
      const n = normalizeStreet(text);
      return !!n && normalizeStreet(s.name) === n;
    });
  }
  if (!found || found === 'ambiguous' || !found.house) return null;
  return { streetId: found.street.id, house: found.house };
}
