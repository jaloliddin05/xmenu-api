import { buildCustomerText, buildRestaurantKeyboard, buildRestaurantText, esc, fmtSum } from './order-messages';
import type { OrderWithItems } from '../services/order-view';

const order = (over: Record<string, unknown> = {}): OrderWithItems =>
  ({
    id: '11111111-1111-1111-1111-111111111111', number: 1042, status: 'pending_acceptance', fulfillment: 'delivery',
    payment_method: 'click', payment_status: 'paid', phone: '+998901234567', comment: 'без <лука> & соуса',
    address_snapshot: { address: 'Шамол оти 42', entrance: '2', floor: '5', apartment: '17', comment: 'ворота синие' },
    service_fee: 16000, total: 113000, cancel_reason: null, cancelled_by: null,
    branch: { id: 'b', title: 'Mant <24/7>', address: 'x' },
    items: [{ name: 'Мант & соус', quantity: 2, unit_price: 48500, position: 0, options: [{ name: 'Катык', position: 0 }, { name: 'Лазжон', position: 1 }] }],
    ...over,
  }) as unknown as OrderWithItems;

describe('restaurant message', () => {
  it('escapes all user-controlled text (HTML parse mode)', () => {
    const text = buildRestaurantText(order());
    expect(text).toContain('Mant &lt;24/7&gt;');
    expect(text).toContain('Мант &amp; соус');
    expect(text).toContain('без &lt;лука&gt; &amp; соуса');
    expect(text).not.toMatch(/<лука>/);
  });

  it('shows items with modifiers, totals, payment state and address details', () => {
    const text = buildRestaurantText(order());
    expect(text).toContain('Заказ №1042');
    expect(text).toContain('Мант &amp; соус ×2 — 97 000 сум');
    expect(text).toContain('Катык, Лазжон');
    expect(text).toContain('Итого: 113 000 сум');
    expect(text).toContain('Click — оплачено');
    expect(text).toContain('подъезд 2, этаж 5, кв. 17');
  });

  it('esc / fmtSum', () => {
    expect(esc('<a&b>')).toBe('&lt;a&amp;b&gt;');
    expect(esc(null)).toBe('');
    expect(fmtSum(1234567)).toBe('1 234 567 сум');
  });
});

describe('restaurant keyboard', () => {
  it('pending → accept / reject; callback data fits Telegram\'s 64 byte limit', () => {
    const kb = buildRestaurantKeyboard(order())!;
    const [accept, reject] = kb.inline_keyboard[0];
    expect(accept.callback_data).toBe('o:a:11111111-1111-1111-1111-111111111111');
    expect(reject.callback_data.startsWith('o:r:')).toBe(true);
    for (const b of kb.inline_keyboard.flat()) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });

  it('follows the order through the kitchen and ends with no buttons', () => {
    expect(buildRestaurantKeyboard(order({ status: 'accepted' }))!.inline_keyboard[0][0].callback_data.startsWith('o:n:')).toBe(true);
    expect(buildRestaurantKeyboard(order({ status: 'preparing', fulfillment: 'pickup' }))!.inline_keyboard[0][0].text).toContain('Готов к выдаче');
    expect(buildRestaurantKeyboard(order({ status: 'on_the_way' }))).not.toBeNull();
    expect(buildRestaurantKeyboard(order({ status: 'completed' }))).toBeNull();
    expect(buildRestaurantKeyboard(order({ status: 'cancelled' }))).toBeNull();
    expect(buildRestaurantKeyboard(order({ status: 'awaiting_payment' }))).toBeNull();
  });
});

describe('customer message', () => {
  it('tells about payment only on the awaiting_payment → pending_acceptance step', () => {
    expect(buildCustomerText(order(), 'awaiting_payment')).toContain('Оплата получена');
    expect(buildCustomerText(order(), null)).toBeNull();
  });

  it('does not message a customer about their own cancellation; mentions the refund otherwise', () => {
    expect(buildCustomerText(order({ status: 'cancelled', cancelled_by: 'customer' }), 'accepted')).toBeNull();
    expect(buildCustomerText(order({ status: 'cancelled', cancelled_by: 'restaurant', payment_status: 'refund_pending' }), 'pending_acceptance')).toContain('вернутся');
    expect(buildCustomerText(order({ status: 'cancelled', cancelled_by: 'restaurant', payment_method: 'cash', payment_status: 'not_required' }), 'pending_acceptance')).not.toContain('вернутся');
  });
});
