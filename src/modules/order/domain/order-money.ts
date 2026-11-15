import { createHash } from 'crypto';

export interface Totals {
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
}

export function computeTotals(
  subtotal: number,
  deliveryFee: number,
  discount = 0,
): Totals {
  return {
    subtotal,
    deliveryFee,
    discount,
    total: Math.max(0, subtotal + deliveryFee - discount),
  };
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
  items: {
    itemId: string;
    quantity: number;
    modifiers?: { groupId: string; optionIds: string[] }[];
  }[];
  expectedTotal?: number;
  expectedDeliveryFee?: number;
  cashChangeFrom?: number;
}): string {
  const canonical = {
    m: request.fulfillmentMode,
    b: request.branchId ?? null,
    a: request.addressId ?? null,
    p: request.phone,
    c: request.comment ?? null,
    pm: request.paymentMethod,
    t: request.expectedTotal ?? null,
    df: request.expectedDeliveryFee ?? null,
    ch: request.cashChangeFrom ?? null,
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
