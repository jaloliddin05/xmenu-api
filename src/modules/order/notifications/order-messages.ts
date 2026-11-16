import type { Lang } from 'src/infra/http/request-helpers';
import { CUSTOMER_TEXTS } from './customer-messages';
import type { OrderWithItems } from '../services/order-view';
import {
  nextRestaurantStatus,
  OrderStatusName,
} from '../domain/order-state-machine';

/**
 * Telegram xabarlari matni (sof funksiyalar). parse_mode=HTML: foydalanuvchi
 * kiritgan har qanday matn (taom nomi, izoh, manzil) esc() dan o'tadi —
 * aks holda `<` yoki `&` Telegram'ning butun xabarni rad etishiga olib keladi.
 */
export const esc = (s: string | null | undefined): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export const fmtSum = (n: number): string =>
  `${new Intl.NumberFormat('ru-RU').format(n).replace(/\u00A0|\u202F/g, ' ')} сум`;

const STATUS_LABEL: Record<OrderStatusName, string> = {
  awaiting_payment: '💳 Ожидает оплаты',
  payment_failed: '⚠️ Оплата не прошла',
  pending_acceptance: '🆕 Ждёт подтверждения',
  accepted: '✅ Принят',
  preparing: '👨‍🍳 Готовится',
  on_the_way: '🛵 В пути',
  ready: '🛍 Готов к выдаче',
  problem_at_door: '🚪 Проблема у двери',
  completed: '🏁 Выполнен',
  cancelled: '❌ Отменён',
  returned_to_restaurant: '↩️ Возвращён в ресторан',
  handed_to_external: '↗️ Передан внешней службе',
};

export const statusLabel = (
  s: OrderStatusName,
  fulfillment: 'delivery' | 'pickup' = 'pickup',
) =>
  s === 'ready' && fulfillment === 'delivery'
    ? '📦 Готов, ждёт курьера'
    : STATUS_LABEL[s];

const PAYMENT_LABEL = {
  cash: 'Наличными',
  click: 'Click',
  payme: 'Payme',
} as const;

export function buildRestaurantText(order: OrderWithItems): string {
  const lines: string[] = [];
  lines.push(
    `<b>Заказ №${order.number}</b> · ${statusLabel(order.status as OrderStatusName, order.fulfillment)}`,
  );
  lines.push(
    `🏪 ${esc(order.branch.title)} · ${order.fulfillment === 'delivery' ? '🛵 Доставка' : '🛍 Самовывоз'}`,
  );

  const paid = order.payment_status === 'paid';
  lines.push(
    `💳 ${PAYMENT_LABEL[order.payment_method]}${order.payment_method === 'cash' ? '' : paid ? ' — оплачено' : ' — не оплачено'}`,
  );
  if (order.cash_change_from != null)
    lines.push(`💵 Сдача с ${fmtSum(order.cash_change_from)}`);
  lines.push('');

  for (const item of [...order.items].sort((a, b) => a.position - b.position)) {
    const extras = [...item.options]
      .sort((a, b) => a.position - b.position)
      .map((o) => esc(o.name));
    lines.push(
      `• ${esc(item.name)} ×${item.quantity} — ${fmtSum(item.unit_price * item.quantity)}`,
    );
    if (extras.length) lines.push(`   <i>${extras.join(', ')}</i>`);
  }
  lines.push('');
  if (order.delivery_fee > 0)
    lines.push(`Доставка: ${fmtSum(order.delivery_fee)}`);
  lines.push(`<b>Итого: ${fmtSum(order.total)}</b>`);
  lines.push('');
  lines.push(`📞 ${esc(order.phone)}`);

  const a = order.address_snapshot as {
    address?: string;
    entrance?: string;
    floor?: string;
    apartment?: string;
    comment?: string;
  } | null;
  if (order.fulfillment === 'delivery' && a?.address) {
    const details = [
      a.entrance && `подъезд ${a.entrance}`,
      a.floor && `этаж ${a.floor}`,
      a.apartment && `кв. ${a.apartment}`,
    ]
      .filter(Boolean)
      .join(', ');
    lines.push(`📍 ${esc(a.address)}${details ? ` (${esc(details)})` : ''}`);
    if (a.comment) lines.push(`🧭 ${esc(a.comment)}`);
  }
  if (order.comment) lines.push(`💬 ${esc(order.comment)}`);

  if (order.status === 'cancelled') {
    lines.push('');
    lines.push(`Причина: ${esc(order.cancel_reason ?? '—')}`);
  }
  return lines.join('\n');
}

export type InlineKeyboard = {
  inline_keyboard: { text: string; callback_data: string }[][];
};

/** Callback data: o:a|o:r|o:n:<orderId> (Telegram chegarasi 64 bayt: 4 + 36 = 40). */
export const CALLBACK = {
  accept: 'o:a:',
  reject: 'o:r:',
  next: 'o:n:',
} as const;

/** Button for the restaurant's next step; a delivery stops at "ready" (the courier moves it on). */
const NEXT_LABEL: Record<
  'delivery' | 'pickup',
  Partial<Record<OrderStatusName, string>>
> = {
  delivery: { accepted: '📦 Готов' },
  pickup: {
    accepted: '👨‍🍳 Начали готовить',
    preparing: '🛍 Готов к выдаче',
    ready: '🏁 Выдан клиенту',
  },
};

export function buildRestaurantKeyboard(
  order: Pick<OrderWithItems, 'id' | 'status' | 'fulfillment'>,
): InlineKeyboard | null {
  const status = order.status as OrderStatusName;
  if (status === 'pending_acceptance') {
    return {
      inline_keyboard: [
        [
          { text: '✅ Принять', callback_data: CALLBACK.accept + order.id },
          { text: '❌ Отклонить', callback_data: CALLBACK.reject + order.id },
        ],
      ],
    };
  }
  const label = NEXT_LABEL[order.fulfillment][status];
  if (nextRestaurantStatus(status, order.fulfillment) && label) {
    return {
      inline_keyboard: [
        [{ text: label, callback_data: CALLBACK.next + order.id }],
      ],
    };
  }
  return null;
}

/** Mijozga Telegram orqali yuboriladigan matn (mijoz tilida); null — yubormaymiz. */
export function buildCustomerText(
  order: Pick<
    OrderWithItems,
    'number' | 'status' | 'payment_method' | 'payment_status' | 'cancelled_by'
  > &
    Partial<
      Pick<OrderWithItems, 'fulfillment' | 'door_problem' | 'external_service'>
    >,
  from: OrderStatusName | null,
  lang: Lang = 'ru',
  courierName: string | null = null,
): string | null {
  const t = CUSTOMER_TEXTS[lang];
  const n = order.number;
  switch (order.status) {
    case 'pending_acceptance':
      return from === 'awaiting_payment' ? t.paymentReceived(n) : null;
    case 'accepted':
      return t.accepted(n);
    case 'preparing':
      return t.preparing(n);
    case 'on_the_way':
      return courierName ? t.onTheWayWith(n, esc(courierName)) : t.onTheWay(n);
    case 'ready':
      if (order.fulfillment !== 'delivery') return t.ready(n);
      // "Cannot deliver" puts the order back to ready: the guest does not need that step again
      return from === 'accepted' ? t.readyForCourier(n) : null;
    case 'problem_at_door':
      return order.door_problem === 'no_answer' ? t.courierAtDoor(n) : null;
    case 'returned_to_restaurant':
      return t.returned(n);
    case 'handed_to_external':
      return t.handedToExternal(n, esc(order.external_service ?? ''));
    case 'completed':
      return t.completed(n);
    case 'cancelled': {
      if (order.cancelled_by === 'customer') return null; // сам отменил — он это видит в приложении
      const refund =
        order.payment_method !== 'cash' &&
        ['refund_pending', 'refunded'].includes(order.payment_status)
          ? `
${t.refundNote}`
          : '';
      return `${t.cancelledByVenue(n)}${refund}`;
    }
    default:
      return null;
  }
}

/** Urgent message to the branch chat about a delivery problem (docs/DELIVERY.md, "Проблемные ситуации"). */
export function buildDeliveryAlertText(
  number: number,
  kind: 'no_answer' | 'refused' | 'cannot_deliver',
  courierName: string | null,
): string {
  const who = courierName ? ` (курьер ${esc(courierName)})` : '';
  switch (kind) {
    case 'no_answer':
      return `📵 <b>Заказ №${number}: курьер у двери и не может дозвониться до гостя${who}.</b>\nЕсли гость не ответит, верните заказ в ресторан или отмените его.`;
    case 'refused':
      return `🚫 <b>Заказ №${number}: гость отказался от заказа${who}.</b>\nВерните заказ в ресторан или отмените его.`;
    case 'cannot_deliver':
      return `⚠️ <b>Срочно: заказ №${number} снова готов и без курьера${who}.</b>\nНазначьте другого курьера.`;
  }
}

/** A delivery timer ran out (domain/delivery-timers.ts): what the branch chat is told. */
export function buildDeliveryTimerText(
  number: number,
  kind: 'pickup' | 'road' | 'door',
  courierName: string | null,
): string {
  const who = courierName ? ` (курьер ${esc(courierName)})` : '';
  switch (kind) {
    case 'pickup':
      return courierName
        ? `⏰ <b>Заказ №${number} готов, но курьер его ещё не забрал${who}.</b>`
        : `⏰ <b>Заказ №${number} готов и ждёт курьера.</b>
Назначьте курьера или передайте заказ внешней службе.`;
    case 'road':
      return `🕐 <b>Заказ №${number} долго в пути${who}.</b>
Свяжитесь с курьером.`;
    case 'door':
      return `⌛ <b>Заказ №${number}: время ожидания у двери вышло${who}.</b>
Верните заказ в ресторан или отмените его.`;
  }
}
