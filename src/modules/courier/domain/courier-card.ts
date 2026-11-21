import type { OrderStatusName } from 'src/modules/order/domain/order-state-machine';
import {
  doorPaymentChoices,
  paidAtDoor,
} from 'src/modules/order/domain/delivery-payment';
import {
  COURIER_TEXTS,
  CourierCardStatus,
  CourierLang,
  REFUSE_REASONS,
  RefuseReason,
} from './courier-texts';

/**
 * The order card in the courier's chat (docs/DELIVERY.md, "Бот курьера"): one message per order, rebuilt
 * from the order on every change. A finished card (delivered, cancelled, returned, handed over, taken off
 * this courier) keeps only the number and the result: the guest's phone and address are removed.
 */

// ---------------------------------------------------------------- callback data

/** Button actions of the courier bot. Telegram limits callback_data to 64 bytes: `cr:<a>:<uuid>[:<arg>]`. */
export type CourierAction =
  | { a: 'pick'; orderId: string }
  | { a: 'pick_all'; branchId: string }
  | { a: 'delivered'; orderId: string }
  /** Delivered a cash order, the guest paid the courier by card */
  | { a: 'delivered_card'; orderId: string }
  | { a: 'no_answer'; orderId: string }
  | { a: 'refuse_menu'; orderId: string }
  | { a: 'refused'; orderId: string; reason: RefuseReason }
  | { a: 'back'; orderId: string }
  | { a: 'cannot_deliver'; orderId: string };

const CODES = {
  pick: 'pk',
  pick_all: 'pa',
  delivered: 'dl',
  delivered_card: 'dc',
  no_answer: 'na',
  refuse_menu: 'rm',
  refused: 'rf',
  back: 'bk',
  cannot_deliver: 'cd',
} as const satisfies Record<CourierAction['a'], string>;

const BY_CODE = Object.fromEntries(
  Object.entries(CODES).map(([a, code]) => [code, a]),
) as Record<string, CourierAction['a']>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCourierAction(action: CourierAction): string {
  const code = CODES[action.a];
  if (action.a === 'pick_all') return `cr:${code}:${action.branchId}`;
  if (action.a === 'refused')
    return `cr:${code}:${action.orderId}:${action.reason}`;
  return `cr:${code}:${action.orderId}`;
}

/** null: not a courier button (or a forged one). */
export function parseCourierAction(
  data: string | undefined,
): CourierAction | null {
  const parts = (data ?? '').split(':');
  if (parts[0] !== 'cr' || parts.length < 3 || parts.length > 4) return null;
  const a = BY_CODE[parts[1]];
  const id = parts[2];
  if (!a || !UUID.test(id)) return null;
  if (a === 'refused') {
    const reason = parts[3] as RefuseReason;
    return REFUSE_REASONS.includes(reason) ? { a, orderId: id, reason } : null;
  }
  if (parts.length !== 3) return null;
  if (a === 'pick_all') return { a, branchId: id };
  return { a, orderId: id };
}

// ---------------------------------------------------------------- card

export interface CourierCardAddress {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  entrance?: string | null;
  floor?: string | null;
  apartment?: string | null;
  comment?: string | null;
}

export interface CourierCardOrder {
  id: string;
  number: number;
  status: OrderStatusName;
  /** The courier the order is assigned to now (null: nobody) */
  courierId: string | null;
  doorProblem: 'no_answer' | 'refused' | null;
  doorProblemReason: string | null;
  branch: { id: string; title: string; address: string };
  guestName: string | null;
  phone: string | null;
  address: CourierCardAddress | null;
  comment: string | null;
  items: { name: string; quantity: number }[];
  total: number;
  currency: string;
  paymentMethod: string;
  cashChangeFrom: number | null;
}

export interface InlineButton {
  text: string;
  callback_data: string;
}
export interface CourierCard {
  text: string;
  /** null: no buttons (the old keyboard is removed when the card is edited) */
  keyboard: { inline_keyboard: InlineButton[][] } | null;
  final: boolean;
}

export interface CardContext {
  /** The courier whose chat shows the card */
  courierId: string;
  lang: CourierLang;
  /** How many of this courier's orders from the same branch are ready (for "Picked up all") */
  readyFromBranch: number;
  /** The refusal reasons menu is open on this card */
  refuseMenu?: boolean;
  /** Cash and card the venue takes at the door now (doorPaymentMethods): which payment buttons to show */
  doorMethods: readonly ('cash' | 'card')[];
}

export function courierCardStatus(
  order: Pick<CourierCardOrder, 'status' | 'courierId' | 'doorProblem'>,
  courierId: string,
): CourierCardStatus {
  if (order.courierId !== courierId) {
    // A finished order keeps its result for the courier who finished it (the courier stays on the order)
    return 'taken_off';
  }
  switch (order.status) {
    case 'ready':
      return 'ready';
    case 'on_the_way':
      return 'on_the_way';
    case 'problem_at_door':
      return order.doorProblem === 'refused' ? 'refused' : 'no_answer';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'returned_to_restaurant':
      return 'returned';
    case 'handed_to_external':
      return 'handed_over';
    default:
      return 'assigned';
  }
}

const FINAL_CARD: ReadonlySet<CourierCardStatus> = new Set([
  'completed',
  'cancelled',
  'returned',
  'handed_over',
  'taken_off',
]);

export function formatMoney(
  amount: number,
  currency: string,
  lang: CourierLang,
): string {
  const n = String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  if (currency === 'UZS')
    return `${n} ${lang === 'uz' ? "so'm" : lang === 'en' ? 'UZS' : 'сум'}`;
  return `${n} ${currency}`;
}

function mapLink(a: CourierCardAddress | null): string | null {
  if (a?.latitude == null || a.longitude == null) return null;
  return `https://yandex.uz/maps/?pt=${a.longitude},${a.latitude}&z=17&l=map`;
}

export function renderCourierCard(
  order: CourierCardOrder,
  ctx: CardContext,
): CourierCard {
  const t = COURIER_TEXTS[ctx.lang];
  const status = courierCardStatus(order, ctx.courierId);
  const head = `${t.order(order.number)}\n${t.status[status]}`;

  if (FINAL_CARD.has(status))
    return { text: head, keyboard: null, final: true };

  const lines: string[] = [head, ''];
  lines.push(`${t.from}: ${order.branch.title}, ${order.branch.address}`);

  const a = order.address;
  const where = [a?.address ?? ''];
  if (a?.entrance) where.push(`${t.entrance} ${a.entrance}`);
  if (a?.floor) where.push(`${t.floor} ${a.floor}`);
  if (a?.apartment) where.push(`${t.apartment} ${a.apartment}`);
  lines.push(`${t.to}: ${where.filter(Boolean).join(', ')}`);
  if (a?.comment) lines.push(`${t.comment}: ${a.comment}`);
  const map = mapLink(a);
  if (map) lines.push(`${t.map}: ${map}`);

  const guest = [order.guestName, order.phone].filter(Boolean).join(', ');
  if (guest) lines.push(`${t.guest}: ${guest}`);
  if (order.comment) lines.push(`${t.comment}: ${order.comment}`);

  lines.push('');
  lines.push(
    `${t.items}: ${order.items.map((i) => `${i.name} × ${i.quantity}`).join('; ')}`,
  );
  const atDoor = paidAtDoor(order.paymentMethod);
  const payLabel =
    order.paymentMethod === 'cash'
      ? t.payCash
      : order.paymentMethod === 'card'
        ? t.payCard
        : t.payOnline;
  lines.push(
    `${t.total}: ${formatMoney(atDoor ? order.total : 0, order.currency, ctx.lang)} (${payLabel})`,
  );
  if (order.paymentMethod === 'cash' && order.cashChangeFrom)
    lines.push(
      `${t.changeFrom}: ${formatMoney(order.cashChangeFrom, order.currency, ctx.lang)}`,
    );
  if (status === 'refused' && order.doorProblemReason) {
    const reason = t.refuseReasons[order.doorProblemReason as RefuseReason];
    if (reason) lines.push(`${t.doorReason}: ${reason}`);
  }

  return {
    text: lines.join('\n'),
    keyboard: keyboardFor(order, status, ctx),
    final: false,
  };
}

function keyboardFor(
  order: CourierCardOrder,
  status: CourierCardStatus,
  ctx: CardContext,
): CourierCard['keyboard'] {
  const t = COURIER_TEXTS[ctx.lang];
  const btn = (text: string, action: CourierAction): InlineButton => ({
    text,
    callback_data: encodeCourierAction(action),
  });
  const id = order.id;
  // Paid at the door: the chosen method first, the other one if the venue takes it now (banknotes are
  // handed in at the shift end, a card is not reconciled); online: just "delivered"
  const choices = doorPaymentChoices(order.paymentMethod, ctx.doorMethods);
  const deliveredRows: InlineButton[][] = choices.length
    ? choices.map((m) => [
        m === 'cash'
          ? btn(t.deliveredCash, { a: 'delivered', orderId: id })
          : btn(t.deliveredCard, { a: 'delivered_card', orderId: id }),
      ])
    : [[btn(t.delivered, { a: 'delivered', orderId: id })]];

  if (status === 'ready') {
    const rows = [[btn(t.pickedUp, { a: 'pick', orderId: id })]];
    if (ctx.readyFromBranch > 1)
      rows.push([
        btn(t.pickedUpAll(ctx.readyFromBranch), {
          a: 'pick_all',
          branchId: order.branch.id,
        }),
      ]);
    return { inline_keyboard: rows };
  }
  if (status === 'on_the_way' && ctx.refuseMenu) {
    return {
      inline_keyboard: [
        ...REFUSE_REASONS.map((reason) => [
          btn(t.refuseReasons[reason], { a: 'refused', orderId: id, reason }),
        ]),
        [btn(t.back, { a: 'back', orderId: id })],
      ],
    };
  }
  if (status === 'on_the_way') {
    return {
      inline_keyboard: [
        ...deliveredRows,
        [
          btn(t.noAnswer, { a: 'no_answer', orderId: id }),
          btn(t.refused, { a: 'refuse_menu', orderId: id }),
        ],
        [btn(t.cannotDeliver, { a: 'cannot_deliver', orderId: id })],
      ],
    };
  }
  // "No answer": the guest may still answer; "refused" waits for the operator only
  if (status === 'no_answer') return { inline_keyboard: deliveredRows };
  return null;
}
