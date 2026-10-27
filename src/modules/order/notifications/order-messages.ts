import type { OrderWithItems } from '../services/order-view';
import { nextRestaurantStatus, OrderStatusName } from '../domain/order-state-machine';

/**
 * Telegram xabarlari matni (sof funksiyalar). parse_mode=HTML: foydalanuvchi
 * kiritgan har qanday matn (taom nomi, izoh, manzil) esc() dan o'tadi —
 * aks holda `<` yoki `&` Telegram'ning butun xabarni rad etishiga olib keladi.
 */
export const esc = (s: string | null | undefined): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const fmtSum = (n: number): string => `${new Intl.NumberFormat('ru-RU').format(n).replace(/\u00A0|\u202F/g, ' ')} сум`;

const STATUS_LABEL: Record<OrderStatusName, string> = {
  awaiting_payment: '💳 Ожидает оплаты',
  payment_failed: '⚠️ Оплата не прошла',
  pending_acceptance: '🆕 Ждёт подтверждения',
  accepted: '✅ Принят',
  preparing: '👨‍🍳 Готовится',
  on_the_way: '🛵 В пути',
  ready: '🛍 Готов к выдаче',
  completed: '🏁 Выполнен',
  cancelled: '❌ Отменён',
};

export const statusLabel = (s: OrderStatusName) => STATUS_LABEL[s];

const PAYMENT_LABEL = { cash: 'Наличными', click: 'Click', payme: 'Payme' } as const;

export function buildRestaurantText(order: OrderWithItems): string {
  const lines: string[] = [];
  lines.push(`<b>Заказ №${order.number}</b> · ${statusLabel(order.status as OrderStatusName)}`);
  lines.push(`🏪 ${esc(order.branch.title)} · ${order.fulfillment === 'delivery' ? '🛵 Доставка' : '🛍 Самовывоз'}`);

  const paid = order.payment_status === 'paid';
  lines.push(`💳 ${PAYMENT_LABEL[order.payment_method]}${order.payment_method === 'cash' ? '' : paid ? ' — оплачено' : ' — не оплачено'}`);
  lines.push('');

  for (const item of [...order.items].sort((a, b) => a.position - b.position)) {
    const extras = [...item.options].sort((a, b) => a.position - b.position).map((o) => esc(o.name));
    lines.push(`• ${esc(item.name)} ×${item.quantity} — ${fmtSum(item.unit_price * item.quantity)}`);
    if (extras.length) lines.push(`   <i>${extras.join(', ')}</i>`);
  }
  lines.push('');
  if (order.service_fee > 0) lines.push(`Сервисный сбор: ${fmtSum(order.service_fee)}`);
  lines.push(`<b>Итого: ${fmtSum(order.total)}</b>`);
  lines.push('');
  lines.push(`📞 ${esc(order.phone)}`);

  const a = order.address_snapshot as { address?: string; entrance?: string; floor?: string; apartment?: string; comment?: string } | null;
  if (order.fulfillment === 'delivery' && a?.address) {
    const details = [a.entrance && `подъезд ${a.entrance}`, a.floor && `этаж ${a.floor}`, a.apartment && `кв. ${a.apartment}`].filter(Boolean).join(', ');
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

export type InlineKeyboard = { inline_keyboard: { text: string; callback_data: string }[][] };

/** Callback data: o:a|o:r|o:n:<orderId> (Telegram chegarasi 64 bayt: 4 + 36 = 40). */
export const CALLBACK = { accept: 'o:a:', reject: 'o:r:', next: 'o:n:' } as const;

const NEXT_LABEL: Partial<Record<OrderStatusName, string>> = {
  accepted: '👨‍🍳 Начали готовить',
  preparing: '🛵 Курьер выехал',
  on_the_way: '🏁 Доставлен',
  ready: '🏁 Выдан клиенту',
};

export function buildRestaurantKeyboard(order: Pick<OrderWithItems, 'id' | 'status' | 'fulfillment'>): InlineKeyboard | null {
  const status = order.status as OrderStatusName;
  if (status === 'pending_acceptance') {
    return {
      inline_keyboard: [[
        { text: '✅ Принять', callback_data: CALLBACK.accept + order.id },
        { text: '❌ Отклонить', callback_data: CALLBACK.reject + order.id },
      ]],
    };
  }
  if (status === 'preparing') {
    const label = order.fulfillment === 'delivery' ? '🛵 Передан курьеру' : '🛍 Готов к выдаче';
    return { inline_keyboard: [[{ text: label, callback_data: CALLBACK.next + order.id }]] };
  }
  if (nextRestaurantStatus(status, order.fulfillment) && NEXT_LABEL[status]) {
    return { inline_keyboard: [[{ text: NEXT_LABEL[status]!, callback_data: CALLBACK.next + order.id }]] };
  }
  return null;
}

/** Mijozga Telegram orqali yuboriladigan matn; null — yubormaymiz. */
export function buildCustomerText(
  order: Pick<OrderWithItems, 'number' | 'status' | 'payment_method' | 'payment_status' | 'cancelled_by'>,
  from: OrderStatusName | null,
): string | null {
  const n = order.number;
  switch (order.status) {
    case 'pending_acceptance':
      return from === 'awaiting_payment' ? `💳 Оплата получена. Заказ №${n} отправлен в ресторан` : null;
    case 'accepted':
      return `✅ Ресторан принял заказ №${n}`;
    case 'preparing':
      return `👨‍🍳 Заказ №${n} готовится`;
    case 'on_the_way':
      return `🛵 Курьер везёт заказ №${n}`;
    case 'ready':
      return `🛍 Заказ №${n} готов к выдаче`;
    case 'completed':
      return `🎉 Заказ №${n} выполнен. Приятного аппетита!`;
    case 'cancelled': {
      if (order.cancelled_by === 'customer') return null; // сам отменил — он это видит в приложении
      const refund = order.payment_method !== 'cash' && ['refund_pending', 'refunded'].includes(order.payment_status)
        ? '\nДеньги за заказ вернутся на ваш счёт.'
        : '';
      return `😔 Заказ №${n} отменён рестораном.${refund}`;
    }
    default:
      return null;
  }
}
