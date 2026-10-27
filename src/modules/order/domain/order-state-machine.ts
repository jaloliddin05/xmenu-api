/**
 * Buyurtma holatlar mashinasi — YAGONA haqiqat manbai. Hech bir joyda status
 * to'g'ridan-to'g'ri yozilmaydi: hammasi OrderTransitionService orqali shu
 * jadvaldan o'tadi (kim, qaysi holatdan qaysi holatga o'tkaza oladi).
 *
 *   awaiting_payment ──to'lov──▶ pending_acceptance ▶ accepted ▶ preparing
 *        │  └─rad/muddat─▶ payment_failed ─qayta─▶ awaiting_payment
 *                                                   │
 *        preparing ▶ on_the_way (delivery) | ready (pickup) ▶ completed
 *
 *   cancelled — awaiting_payment / payment_failed / pending_acceptance /
 *   accepted dan mijoz; pending_acceptance dan boshlab restoran; tizim
 *   (vaqt tugashi) — faqat hali tayyorlanmagan holatlardan.
 */

export const ORDER_STATUSES = [
  'awaiting_payment',
  'payment_failed',
  'pending_acceptance',
  'accepted',
  'preparing',
  'on_the_way',
  'ready',
  'completed',
  'cancelled',
] as const;
export type OrderStatusName = (typeof ORDER_STATUSES)[number];

export type OrderActorName = 'customer' | 'restaurant' | 'system' | 'payment';
export type FulfillmentName = 'delivery' | 'pickup';

type Rule = { to: OrderStatusName; actors: OrderActorName[]; only?: FulfillmentName };

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
    { to: 'cancelled', actors: ['customer', 'restaurant', 'system', 'payment'] },
  ],
  accepted: [
    { to: 'preparing', actors: ['restaurant'] },
    // 'payment' — provayder (Payme) to'lovni o'zi qaytarganda
    { to: 'cancelled', actors: ['customer', 'restaurant', 'payment'] },
  ],
  preparing: [
    { to: 'on_the_way', actors: ['restaurant'], only: 'delivery' },
    { to: 'ready', actors: ['restaurant'], only: 'pickup' },
    { to: 'cancelled', actors: ['restaurant'] },
  ],
  on_the_way: [
    { to: 'completed', actors: ['restaurant'] },
    { to: 'cancelled', actors: ['restaurant'] },
  ],
  ready: [
    { to: 'completed', actors: ['restaurant'] },
    { to: 'cancelled', actors: ['restaurant'] },
  ],
  completed: [],
  cancelled: [],
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

  const rule = RULES[from].find((r) => r.to === to && r.actors.includes(actor));
  if (!rule) return { ok: false, reason: 'not_allowed' };
  if (rule.only && rule.only !== fulfillment) return { ok: false, reason: 'wrong_fulfillment' };
  return { ok: true };
}

export const isFinalStatus = (s: OrderStatusName) => s === 'completed' || s === 'cancelled';

/** Mijoz ilovadan bekor qila oladigan holatlar (frontend CUSTOMER_CANCELLABLE bilan bir xil). */
export const CUSTOMER_CANCELLABLE: ReadonlySet<OrderStatusName> = new Set([
  'awaiting_payment',
  'payment_failed',
  'pending_acceptance',
  'accepted',
]);

/** Restoran buyurtmani ko'rishi kerak bo'lgan "jonli" holatlar. */
export const LIVE_STATUSES: readonly OrderStatusName[] = [
  'pending_acceptance',
  'accepted',
  'preparing',
  'on_the_way',
  'ready',
];

/** Mijozning "faol buyurtma" hisobiga kiradigan holatlar (final emas). */
export const ACTIVE_STATUSES: readonly OrderStatusName[] = [
  'awaiting_payment',
  'payment_failed',
  ...LIVE_STATUSES,
];

/** Restoran bu holatlardan keyingi bosqichga o'tkaza oladi (preparing → on_the_way/ready fulfillment bo'yicha). */
export function nextRestaurantStatus(
  from: OrderStatusName,
  fulfillment: FulfillmentName,
): OrderStatusName | null {
  switch (from) {
    case 'pending_acceptance':
      return 'accepted';
    case 'accepted':
      return 'preparing';
    case 'preparing':
      return fulfillment === 'delivery' ? 'on_the_way' : 'ready';
    case 'on_the_way':
    case 'ready':
      return 'completed';
    default:
      return null;
  }
}
