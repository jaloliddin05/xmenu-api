import { createHash } from 'crypto';

/** Nuqta ko'pburchak ichidami (ray casting). polygon: [[lat, lng], ...] */
export function pointInPolygon(lat: number, lng: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** DB'dan kelgan JSON ni xavfsiz [lat, lng][] ga aylantiradi; yaroqsiz bo'lsa null (no zone: delivery is unavailable). */
export function parseZone(value: unknown): [number, number][] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const points: [number, number][] = [];
  for (const p of value) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return null;
    }
    points.push([p[0], p[1]]);
  }
  return points;
}

/**
 * Why a delivery address cannot be served, or null when it can. Without a zone drawn by the owner
 * delivery is unavailable rather than open to any point; an address without coordinates is outside.
 */
export function deliveryZoneProblem(
  zone: [number, number][] | null,
  address: { latitude: number | null; longitude: number | null },
): 'delivery_unavailable_no_zone' | 'out_of_delivery_zone' | null {
  if (!zone) return 'delivery_unavailable_no_zone';
  if (address.latitude == null || address.longitude == null) return 'out_of_delivery_zone';
  return pointInPolygon(address.latitude, address.longitude, zone) ? null : 'out_of_delivery_zone';
}

export interface Totals {
  subtotal: number;
  serviceFee: number;
  discount: number;
  total: number;
}

export function computeTotals(subtotal: number, serviceFee: number, discount = 0): Totals {
  return { subtotal, serviceFee, discount, total: Math.max(0, subtotal + serviceFee - discount) };
}

/** UZS float (DB) → butun so'm. Narx kasr bo'lsa yaxlitlanadi. */
export const toSum = (value: number): number => Math.round(value);

/**
 * Buyurtma so'rovining barqaror hash'i (Idempotency-Key bilan birga). Tartib
 * ahamiyatsiz joylar (modifier optionIds) saralanadi; ahamiyatli joylar
 * (items tartibi) o'zgarishsiz qoladi.
 */
export function hashOrderRequest(request: {
  fulfillmentMode: string;
  branchId?: string;
  addressId?: string;
  phone: string;
  comment?: string;
  paymentMethod: string;
  items: { itemId: string; quantity: number; modifiers?: { groupId: string; optionIds: string[] }[] }[];
  expectedTotal?: number;
}): string {
  const canonical = {
    m: request.fulfillmentMode,
    b: request.branchId ?? null,
    a: request.addressId ?? null,
    p: request.phone,
    c: request.comment ?? null,
    pm: request.paymentMethod,
    t: request.expectedTotal ?? null,
    i: request.items.map((item) => ({
      id: item.itemId,
      q: item.quantity,
      mod: [...(item.modifiers ?? [])]
        .map((m) => ({ g: m.groupId, o: [...m.optionIds].sort() }))
        .sort((a, b) => a.g.localeCompare(b.g)),
    })),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
