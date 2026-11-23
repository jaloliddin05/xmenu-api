/**
 * The venue delivery area (docs/DELIVERY.md, "Общая зона доставки заведения"): a list of parts, each a ready
 * region of the catalog (copied in, read-only) or a part the owner drew (one outer ring, no holes). An address is
 * in the area when it is inside at least one part (even-odd over the rings of the part); parts are not merged.
 */
import type { FieldError } from 'src/infra/errors/app-exception';
import type { DefaultRule } from 'src/modules/branch/domain/delivery-pricing';
import {
  LatLng,
  pointInRings,
  Ring,
  roundRing,
  selfIntersects,
} from './geometry';

export interface DeliveryArea {
  /** Rings of every part; never empty (no parts = no area). */
  parts: Ring[][];
  defaultRule: DefaultRule;
}

export const AREA_PART_SOURCES = ['region', 'custom'] as const;
export type AreaPartSource = (typeof AREA_PART_SOURCES)[number];

export const MAX_CUSTOM_PARTS = 10;
export const MAX_REGION_PARTS = 14;
export const MIN_CUSTOM_POINTS = 3;
export const MAX_CUSTOM_POINTS = 200;
/** Owner-drawn points are kept to 6 decimals (about 0.1 m). */
export const STORED_DIGITS = 6;
/** Guests get 5 decimals (about 1 m): less to download, nothing a map shows. */
export const PUBLIC_DIGITS = 5;

/**
 * Uzbekistan (37.2–45.6 N, 56.0–73.2 E) with a margin. A drawn point outside is a mistake, most often lat and
 * lng swapped (69, 41 lands in the Arctic).
 */
export const COUNTRY_BOUNDS = {
  minLat: 36,
  maxLat: 46.5,
  minLng: 55,
  maxLng: 74.5,
} as const;

export const inArea = (area: DeliveryArea, [lat, lng]: LatLng): boolean =>
  area.parts.some((rings) => pointInRings(lat, lng, rings));

export interface AreaPartInput {
  source: AreaPartSource;
  code?: string;
  polygon?: unknown;
}

const isPair = (p: unknown): p is [number, number] =>
  Array.isArray(p) &&
  p.length === 2 &&
  p.every((n) => typeof n === 'number' && Number.isFinite(n));

const inCountry = ([lat, lng]: LatLng) =>
  lat >= COUNTRY_BOUNDS.minLat &&
  lat <= COUNTRY_BOUNDS.maxLat &&
  lng >= COUNTRY_BOUNDS.minLng &&
  lng <= COUNTRY_BOUNDS.maxLng;

/** A drawn polygon as stored: [lat, lng] pairs rounded to 6 decimals; null when it is not a list of pairs. */
export function customRing(polygon: unknown): Ring | null {
  if (!Array.isArray(polygon) || !polygon.every(isPair)) return null;
  return roundRing(polygon, STORED_DIGITS);
}

/**
 * Checks of PUT /organization/:id/delivery-area the DTO cannot express. Field paths as in validation_error
 * (parts[2].polygon). `knownRegion` tells a catalog code.
 *  - region: a known code, each code once, at most MAX_REGION_PARTS;
 *  - custom: [lat, lng] pairs, 3–200 points, inside the country (outside_bounds), no repeated neighbours and
 *    no crossing edges after rounding (self_intersection), at most MAX_CUSTOM_PARTS.
 */
export function areaPartsProblems(
  parts: AreaPartInput[],
  knownRegion: (code: string) => boolean,
): FieldError[] {
  const problems: FieldError[] = [];
  const seen = new Set<string>();
  let regions = 0;
  let custom = 0;
  parts.forEach((part, i) => {
    if (part.source === 'region') {
      regions++;
      const code = part.code ?? '';
      if (!knownRegion(code))
        problems.push({
          field: `parts[${i}].code`,
          code: 'unknown_region',
          message: 'No such region in the catalog',
        });
      else if (seen.has(code))
        problems.push({
          field: `parts[${i}].code`,
          code: 'duplicate',
          message: 'The region is listed twice',
        });
      seen.add(code);
      return;
    }
    custom++;
    const field = `parts[${i}].polygon`;
    const ring = customRing(part.polygon);
    if (
      !ring ||
      ring.length < MIN_CUSTOM_POINTS ||
      ring.length > MAX_CUSTOM_POINTS
    ) {
      problems.push({
        field,
        code: 'polygon',
        message: `polygon must be [[lat, lng], ...] with ${MIN_CUSTOM_POINTS} to ${MAX_CUSTOM_POINTS} points`,
      });
    } else if (!ring.every(inCountry)) {
      problems.push({
        field,
        code: 'outside_bounds',
        message:
          'Every point must be [lat, lng] inside Uzbekistan (are lat and lng swapped?)',
      });
    } else if (selfIntersects(ring)) {
      problems.push({
        field,
        code: 'self_intersection',
        message: 'The outline must not cross or touch itself',
      });
    }
  });
  if (regions > MAX_REGION_PARTS)
    problems.push({
      field: 'parts',
      code: 'array_max_size',
      message: `At most ${MAX_REGION_PARTS} regions`,
    });
  if (custom > MAX_CUSTOM_PARTS)
    problems.push({
      field: 'parts',
      code: 'array_max_size',
      message: `At most ${MAX_CUSTOM_PARTS} drawn parts`,
    });
  return problems;
}

/** Stored part geometry → rings; null when broken (the part is then skipped, as broken branch zones are). */
export function parseRings(value: unknown): Ring[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rings: Ring[] = [];
  for (const ring of value) {
    if (!Array.isArray(ring) || ring.length < 3 || !ring.every(isPair))
      return null;
    rings.push(ring.map(([lat, lng]) => [lat, lng] as LatLng));
  }
  return rings;
}
