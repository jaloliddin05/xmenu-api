/**
 * Buyurtma holatlar mashinasi — YAGONA haqiqat manbai. Hech bir joyda status
 * to'g'ridan-to'g'ri yozilmaydi: hammasi OrderTransitionService orqali shu
 * jadvaldan o'tadi (kim, qaysi holatdan qaysi holatga o'tkaza oladi).
 *
 *   awaiting_payment ──to'lov──▶ pending_acceptance ▶ accepted
 *        │  └─rad/muddat─▶ payment_failed ─qayta─▶ awaiting_payment
 *
 * Pickup:   accepted ▶ preparing ▶ ready ▶ completed (all by the restaurant)
 *
 * Delivery (docs/DELIVERY.md, "Статусы заказа"; the courier is assigned on "accepted", not a status):
 *   accepted ─operator─▶ ready ─courier "picked up"─▶ on_the_way ─courier "delivered"─▶ completed
 *   on_the_way ─courier "cannot deliver"─▶ ready (no courier)
 *   on_the_way | problem_at_door ─system (the courier was disabled)─▶ ready (no courier)
 *   on_the_way ─courier "no answer" / "refused"─▶ problem_at_door
 *   problem_at_door ─courier "delivered" (no answer only)─▶ completed
 *   problem_at_door ─operator─▶ returned_to_restaurant | cancelled
 *   accepted | ready ─operator─▶ handed_to_external (closed at once)
 *
 * POS (iiko, docs/IIKO.md "Путь заказа и статусы"): actor `pos` moves an order sent to iiko forward along
 * the same path (cooked → ready; with iiko couriers on the way and delivered; closed → completed) and
 * cancels it when iiko cancels it.
 *
 *   cancelled — awaiting_payment / payment_failed / pending_acceptance dan mijoz
 *   (the guest never cancels an accepted order); pending_acceptance dan boshlab restoran (yakunlanguncha);
 *   tizim (vaqt tugashi) — faqat hali qabul qilinmagan holatlardan.
 */

export const ORDER_STATUSES = [
  'awaiting_payment',
  'payment_failed',
  'pending_acceptance',
  'accepted',
  'preparing',
  'on_the_way',
  'ready',
  'problem_at_door',
  'completed',
  'cancelled',
  'returned_to_restaurant',
  'handed_to_external',
] as const;
export type OrderStatusName = (typeof ORDER_STATUSES)[number];

export type OrderActorName =
  | 'customer'
  | 'restaurant'
  | 'courier'
  | 'system'
  | 'payment'
  | 'pos';
export type FulfillmentName = 'delivery' | 'pickup';

type Rule = {
  to: OrderStatusName;
  actors: OrderActorName[];
  only?: FulfillmentName;
};

const RULES: Record<OrderStatusName, Rule[]> = {
  awaiting_payment: [
    { to: 'pending_acceptance', actors: ['payment'] },
    { to: 'payment_failed', actors: ['payment', 'system'] },
    { to: 'cancelled', actors: ['customer', 'system'] },
  ],
  payment_failed: [
    { to: 'awaiting_payment', actors: ['customer'] },
    { to: 'cancelled', actors: ['customer', 'system'] },
  ],
  pending_acceptance: [
    { to: 'accepted', actors: ['restaurant'] },
    {
      to: 'cancelled',
      actors: ['customer', 'restaurant', 'system', 'payment'],
    },
  ],
  accepted: [
    { to: 'preparing', actors: ['restaurant', 'pos'], only: 'pickup' },
    { to: 'ready', actors: ['restaurant', 'pos'], only: 'delivery' },
    { to: 'handed_to_external', actors: ['restaurant'], only: 'delivery' },
    // 'payment' — provayder (Payme) to'lovni o'zi qaytarganda
    // The guest cancels only until the restaurant accepts, pickup and delivery alike (docs/DELIVERY.md)
    { to: 'cancelled', actors: ['restaurant', 'payment', 'pos'] },
  ],
  preparing: [
    { to: 'ready', actors: ['restaurant', 'pos'], only: 'pickup' },
    { to: 'cancelled', actors: ['restaurant', 'pos'], only: 'pickup' },
  ],
  ready: [
    { to: 'completed', actors: ['restaurant', 'pos'], only: 'pickup' },
    { to: 'on_the_way', actors: ['courier', 'pos'], only: 'delivery' },
    { to: 'handed_to_external', actors: ['restaurant'], only: 'delivery' },
    { to: 'cancelled', actors: ['restaurant', 'pos'] },
  ],
  on_the_way: [
    { to: 'completed', actors: ['courier', 'pos'], only: 'delivery' },
    { to: 'ready', actors: ['courier', 'system'], only: 'delivery' },
    { to: 'problem_at_door', actors: ['courier'], only: 'delivery' },
    { to: 'cancelled', actors: ['restaurant', 'pos'], only: 'delivery' },
  ],
  problem_at_door: [
    { to: 'completed', actors: ['courier'], only: 'delivery' },
    { to: 'returned_to_restaurant', actors: ['restaurant'], only: 'delivery' },
    { to: 'ready', actors: ['system'], only: 'delivery' },
    { to: 'cancelled', actors: ['restaurant'], only: 'delivery' },
  ],
  completed: [],
  cancelled: [],
  returned_to_restaurant: [],
  handed_to_external: [],
};

export type TransitionCheck =
  | { ok: true }
  | { ok: false; reason: 'final' | 'not_allowed' | 'wrong_fulfillment' };

export function checkTransition(
  from: OrderStatusName,
  to: OrderStatusName,
  actor: OrderActorName,
  fulfillment: FulfillmentName,
): TransitionCheck {
  if (isFinalStatus(from)) return { ok: false, reason: 'final' };

  const rules = RULES[from].filter(
    (r) => r.to === to && r.actors.includes(actor),
  );
  if (!rules.length) return { ok: false, reason: 'not_allowed' };
  if (!rules.some((r) => !r.only || r.only === fulfillment))
    return { ok: false, reason: 'wrong_fulfillment' };
  return { ok: true };
}

export const FINAL_STATUSES: readonly OrderStatusName[] = [
  'completed',
  'cancelled',
  'returned_to_restaurant',
  'handed_to_external',
];

export const isFinalStatus = (s: OrderStatusName) => FINAL_STATUSES.includes(s);

/** Mijoz ilovadan bekor qila oladimi (frontend CUSTOMER_CANCELLABLE bilan bir xil). */
export function customerCanCancel(
  status: OrderStatusName,
  fulfillment: FulfillmentName,
): boolean {
  return checkTransition(status, 'cancelled', 'customer', fulfillment).ok;
}

/** Restoran buyurtmani ko'rishi kerak bo'lgan "jonli" holatlar. */
export const LIVE_STATUSES: readonly OrderStatusName[] = [
  'pending_acceptance',
  'accepted',
  'preparing',
  'on_the_way',
  'ready',
  'problem_at_door',
];

/**
 * cancel_reason of an order the guest left in payment_failed for PAYMENT_FAILED_TTL_HOURS (cancelled by the
 * system, queue/payment-failed-expiry.service.ts; no message to the guest)
 */
export const PAYMENT_EXPIRED_REASON = 'payment_expired';

/** Mijozning "faol buyurtma" hisobiga kiradigan holatlar (final emas). */
export const ACTIVE_STATUSES: readonly OrderStatusName[] = [
  'awaiting_payment',
  'payment_failed',
  ...LIVE_STATUSES,
];

/** Delivery statuses in which an order holds its courier (not finished yet). */
export const COURIER_HELD_STATUSES: readonly OrderStatusName[] = [
  'accepted',
  'ready',
  'on_the_way',
  'problem_at_door',
];

/** After "picked up" the courier is changed only through "cannot deliver" or an operator's decision. */
export const COURIER_LOCKED_STATUSES: readonly OrderStatusName[] = [
  'on_the_way',
  'problem_at_door',
];

/**
 * The next step the restaurant takes itself ("advance"). Delivery stops at "ready": from there the courier
 * moves the order (picked up, delivered).
 */
export function nextRestaurantStatus(
  from: OrderStatusName,
  fulfillment: FulfillmentName,
): OrderStatusName | null {
  switch (from) {
    case 'pending_acceptance':
      return 'accepted';
    case 'accepted':
      return fulfillment === 'delivery' ? 'ready' : 'preparing';
    case 'preparing':
      return fulfillment === 'pickup' ? 'ready' : null;
    case 'ready':
      return fulfillment === 'pickup' ? 'completed' : null;
    default:
      return null;
  }
}
