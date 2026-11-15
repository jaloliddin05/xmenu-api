import {
  KM_EPSILON,
  distanceKm,
} from 'src/modules/branch/domain/delivery-pricing';

/**
 * Courier pay (docs/DELIVERY.md, "Оплата курьеру"): a rate per delivery plus a sum for every started kilometre
 * in a straight line from the branch to the address over the included distance. The venue sets a rate, a
 * courier may have an own one; without any rate nothing is accrued. Pay is counted at delivery and kept in the
 * order, so later rate changes do not rewrite it.
 */
export interface PayRate {
  perDelivery: number;
  includedKm: number;
  perKm: number;
}

/** A rate stored as three nullable columns: complete or none. */
export function payRateOf(row: {
  perDelivery: number | null;
  includedKm: number | null;
  perKm: number | null;
}): PayRate | null {
  if (row.perDelivery == null || row.includedKm == null || row.perKm == null)
    return null;
  return {
    perDelivery: row.perDelivery,
    includedKm: row.includedKm,
    perKm: row.perKm,
  };
}

/** The courier's own rate wins as a whole; otherwise the venue's. */
export function effectiveRate(
  own: PayRate | null,
  venue: PayRate | null,
): PayRate | null {
  return own ?? venue;
}

export function courierPay(rate: PayRate | null, km: number): number | null {
  if (!rate) return null;
  const extra = Math.max(0, Math.ceil(km - rate.includedKm - KM_EPSILON));
  return rate.perDelivery + extra * rate.perKm;
}

/** Straight-line km from the branch to the delivery address; 0 when the address has no coordinates. */
export function deliveryDistanceKm(
  branch: { latitude: number; longitude: number },
  addressSnapshot: unknown,
): number {
  const a = addressSnapshot as {
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  if (typeof a?.latitude !== 'number' || typeof a?.longitude !== 'number')
    return 0;
  return distanceKm(
    [branch.latitude, branch.longitude],
    [a.latitude, a.longitude],
  );
}
