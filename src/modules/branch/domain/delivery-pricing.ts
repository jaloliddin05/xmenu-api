/**
 * Delivery price of a branch for an address (docs/DELIVERY.md, "Стоимость доставки и выбор филиала"). Pure
 * functions: the same rules serve the cart quote, the order and the owner's price check.
 *
 * 1. The address is inside a zone of the branch: the first zone in the owner's order that contains it.
 * 2. Outside every zone but within the distance rule's max_km: the distance price.
 * 3. Otherwise the branch does not deliver there.
 * 4. Subtotal (without delivery) at or above the rule's free_from: delivery is free.
 * 5. Subtotal below the rule's min_order: the order cannot be placed (shortBy says how much is missing).
 * The fee is rounded up to the venue step (100, 500 or 1000).
 */

/** [lat, lng] */
export type LatLng = [number, number];

export interface ZoneRule {
  polygon: LatLng[];
  price: number;
  minOrder: number;
  freeFrom: number | null;
}

export interface DistanceRule {
  basePrice: number;
  includedKm: number;
  /** Added for every started kilometre over includedKm */
  pricePerKm: number;
  maxKm: number;
  minOrder: number;
  freeFrom: number | null;
}

/** Zones in the owner's order (position), first wins where they overlap. */
export interface DeliveryRules {
  zones: ZoneRule[];
  distance: DistanceRule | null;
}

export const DELIVERY_PRICE_STEPS = [100, 500, 1000] as const;
export type DeliveryPriceStep = (typeof DELIVERY_PRICE_STEPS)[number];

/** A branch delivers only when the owner set at least one rule. */
export const hasRules = (rules: DeliveryRules): boolean =>
  rules.zones.length > 0 || rules.distance !== null;

/** Nuqta ko'pburchak ichidami (ray casting). polygon: [[lat, lng], ...] */
export function pointInPolygon(
  lat: number,
  lng: number,
  polygon: LatLng[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const crosses =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** DB'dan kelgan JSON ni xavfsiz [lat, lng][] ga aylantiradi; yaroqsiz bo'lsa null. */
export function parseZone(value: unknown): LatLng[] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const points: LatLng[] = [];
  for (const p of value) {
    if (
      !Array.isArray(p) ||
      p.length !== 2 ||
      !p.every((n) => typeof n === 'number' && Number.isFinite(n))
    ) {
      return null;
    }
    points.push([p[0] as number, p[1] as number]);
  }
  return points;
}

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle (straight line) distance in km. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Float noise must not start a kilometre or push an address over max_km (2.0000000001 km is 2 km)
const KM_EPSILON = 1e-9;

/** The rule that prices this address, or null when the branch does not deliver there. */
export type DeliveryRate =
  | { rule: 'zone'; zoneIndex: number; distanceKm: number }
  | { rule: 'distance'; distanceKm: number };

export function rateFor(
  rules: DeliveryRules,
  branchPoint: LatLng,
  address: LatLng,
): DeliveryRate | null {
  const km = distanceKm(branchPoint, address);
  const zoneIndex = rules.zones.findIndex((z) =>
    pointInPolygon(address[0], address[1], z.polygon),
  );
  if (zoneIndex >= 0) return { rule: 'zone', zoneIndex, distanceKm: km };
  if (rules.distance && km <= rules.distance.maxKm + KM_EPSILON)
    return { rule: 'distance', distanceKm: km };
  return null;
}

/** Distance price before rounding: base plus every started km over the included ones. */
export function distanceFee(rule: DistanceRule, km: number): number {
  const extra = Math.max(0, Math.ceil(km - rule.includedKm - KM_EPSILON));
  return rule.basePrice + extra * rule.pricePerKm;
}

export function roundUpToStep(fee: number, step: number): number {
  return Math.ceil(fee / step) * step;
}

export interface DeliveryPrice {
  rule: 'zone' | 'distance';
  /** Index in rules.zones; null for the distance rule */
  zoneIndex: number | null;
  distanceKm: number;
  /** Rounded up to the venue step; 0 when free */
  deliveryFee: number;
  freeFrom: number | null;
  minOrder: number;
  /** How much the subtotal misses to minOrder; 0 when enough */
  shortBy: number;
}

export function priceDelivery(
  rules: DeliveryRules,
  rate: DeliveryRate,
  subtotal: number,
  step: number,
): DeliveryPrice {
  const rule =
    rate.rule === 'zone' ? rules.zones[rate.zoneIndex] : rules.distance!;
  const raw =
    rate.rule === 'zone'
      ? rules.zones[rate.zoneIndex].price
      : distanceFee(rules.distance!, rate.distanceKm);
  const free = rule.freeFrom !== null && subtotal >= rule.freeFrom;
  return {
    rule: rate.rule,
    zoneIndex: rate.rule === 'zone' ? rate.zoneIndex : null,
    distanceKm: rate.distanceKm,
    deliveryFee: free ? 0 : roundUpToStep(raw, step),
    freeFrom: rule.freeFrom,
    minOrder: rule.minOrder,
    shortBy: Math.max(0, rule.minOrder - subtotal),
  };
}

export interface RuleProblem {
  field: string;
  code: string;
  message: string;
}

const validPoint = ([lat, lng]: LatLng) =>
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

/**
 * Checks the DTO cannot express: every polygon point is a [lat, lng] pair on the map, and the distance rule
 * does not end before its included kilometres. Field paths as in validation_error (zones[0].polygon).
 */
export function deliveryRulesProblems(input: {
  zones: { polygon: unknown }[];
  distance?: { includedKm: number; maxKm: number } | null;
}): RuleProblem[] {
  const problems: RuleProblem[] = [];
  input.zones.forEach((z, i) => {
    const points = parseZone(z.polygon);
    if (!points || !points.every(validPoint))
      problems.push({
        field: `zones[${i}].polygon`,
        code: 'polygon',
        message: 'polygon must be [[lat, lng], ...] with at least 3 points',
      });
  });
  const d = input.distance;
  if (d && d.maxKm < d.includedKm)
    problems.push({
      field: 'distance.maxKm',
      code: 'min',
      message: 'maxKm must not be less than includedKm',
    });
  return problems;
}
