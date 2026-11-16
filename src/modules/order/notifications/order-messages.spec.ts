import {
  buildCustomerText,
  buildDeliveryAlertText,
  buildRestaurantKeyboard,
  buildRestaurantText,
  esc,
  fmtSum,
} from './order-messages';
import type { OrderWithItems } from '../services/order-view';

const order = (over: Record<string, unknown> = {}): OrderWithItems =>
  ({
    id: '11111111-1111-1111-1111-111111111111',
    number: 1042,
    status: 'pending_acceptance',
    fulfillment: 'delivery',
    payment_method: 'click',
    payment_status: 'paid',
    phone: '+998901234567',
    comment: 'без <лука> & соуса',
    address_snapshot: {
      address: 'Шамол оти 42',
      entrance: '2',
      floor: '5',
      apartment: '17',
      comment: 'ворота синие',
    },
    service_fee: 16000,
    total: 113000,
    cancel_reason: null,
    cancelled_by: null,
    branch: { id: 'b', title: 'Mant <24/7>', address: 'x' },
    items: [
      {
        name: 'Мант & соус',
        quantity: 2,
        unit_price: 48500,
        position: 0,
        options: [
          { name: 'Катык', position: 0 },
          { name: 'Лазжон', position: 1 },
        ],
      },
    ],
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
  it("pending → accept / reject; callback data fits Telegram's 64 byte limit", () => {
    const kb = buildRestaurantKeyboard(order())!;
    const [accept, reject] = kb.inline_keyboard[0];
    expect(accept.callback_data).toBe(
      'o:a:11111111-1111-1111-1111-111111111111',
    );
    expect(reject.callback_data.startsWith('o:r:')).toBe(true);
    for (const b of kb.inline_keyboard.flat())
      expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });

  it('follows the order through the kitchen and ends with no buttons', () => {
    expect(
      buildRestaurantKeyboard(
        order({ status: 'accepted' }),
      )!.inline_keyboard[0][0].callback_data.startsWith('o:n:'),
    ).toBe(true);
    expect(
      buildRestaurantKeyboard(
        order({ status: 'preparing', fulfillment: 'pickup' }),
      )!.inline_keyboard[0][0].text,
    ).toContain('Готов к выдаче');
    expect(
      buildRestaurantKeyboard(
        order({ status: 'ready', fulfillment: 'pickup' }),
      ),
    ).not.toBeNull();
    expect(buildRestaurantKeyboard(order({ status: 'completed' }))).toBeNull();
    // A delivery stops at "ready": picked up and delivered are the courier's buttons, not the branch chat's
    expect(
      buildRestaurantKeyboard(
        order({ status: 'accepted', fulfillment: 'delivery' }),
      )!.inline_keyboard[0][0].text,
    ).toContain('Готов');
    for (const status of ['ready', 'on_the_way', 'problem_at_door'] as const)
      expect(
        buildRestaurantKeyboard(order({ status, fulfillment: 'delivery' })),
      ).toBeNull();
    expect(buildRestaurantKeyboard(order({ status: 'cancelled' }))).toBeNull();
    expect(
      buildRestaurantKeyboard(order({ status: 'awaiting_payment' })),
    ).toBeNull();
  });
});

describe('customer message languages', () => {
  it.each([
    ['ru', /№1042/, 'готовится'],
    ['uz', /№1042/, 'tayyorlanmoqda'],
    ['en', /#1042/, 'prepared'],
  ] as const)('%s', (lang, num, word) => {
    const text = buildCustomerText(order({ status: 'preparing' }), null, lang)!;
    expect(text).toMatch(num);
    expect(text).toContain(word);
  });

  it('keeps the refund note in every language and Latin script for uz', () => {
    const cancelled = order({
      status: 'cancelled',
      cancelled_by: 'restaurant',
      payment_status: 'refund_pending',
    });
    for (const lang of ['ru', 'uz', 'en'] as const)
      expect(
        buildCustomerText(cancelled, 'pending_acceptance', lang),
      ).toContain('\n');
    expect(
      buildCustomerText(cancelled, 'pending_acceptance', 'uz'),
    ).not.toMatch(/[\u0400-\u04FF]/);
  });
});

describe('customer message', () => {
  it('tells about payment only on the awaiting_payment → pending_acceptance step', () => {
    expect(buildCustomerText(order(), 'awaiting_payment')).toContain(
      'Оплата получена',
    );
    expect(buildCustomerText(order(), null)).toBeNull();
  });

  it('does not message a customer about their own cancellation; mentions the refund otherwise', () => {
    expect(
      buildCustomerText(
        order({ status: 'cancelled', cancelled_by: 'customer' }),
        'accepted',
      ),
    ).toBeNull();
    expect(
      buildCustomerText(
        order({
          status: 'cancelled',
          cancelled_by: 'restaurant',
          payment_status: 'refund_pending',
        }),
        'pending_acceptance',
      ),
    ).toContain('вернутся');
    expect(
      buildCustomerText(
        order({
          status: 'cancelled',
          cancelled_by: 'restaurant',
          payment_method: 'cash',
          payment_status: 'not_required',
        }),
        'pending_acceptance',
      ),
    ).not.toContain('вернутся');
  });
});

describe('customer message for delivery steps', () => {
  const delivery = (status: string, over: Record<string, unknown> = {}) =>
    order({ status, fulfillment: 'delivery', payment_method: 'cash', ...over });
  it('ready: "waiting for the courier" once, not again after "cannot deliver"', () => {
    expect(buildCustomerText(delivery('ready'), 'accepted')).toBe(
      '📦 Заказ №1042 готов и ждёт курьера',
    );
    expect(buildCustomerText(delivery('ready'), 'on_the_way')).toBeNull();
    expect(
      buildCustomerText(
        order({ status: 'ready', fulfillment: 'pickup' }),
        'preparing',
      ),
    ).toContain('готов к выдаче');
  });
  it('on the way with the courier name; at the door only when the guest does not answer; returned', () => {
    expect(
      buildCustomerText(delivery('on_the_way'), 'ready', 'ru', 'Bekzod'),
    ).toBe('🛵 Заказ №1042 в пути, курьер Bekzod');
    expect(
      buildCustomerText(
        delivery('problem_at_door', { door_problem: 'no_answer' }),
        'on_the_way',
        'uz',
      ),
    ).toContain("qo'ng'iroq qila olmayapti");
    expect(
      buildCustomerText(
        delivery('problem_at_door', { door_problem: 'refused' }),
        'on_the_way',
      ),
    ).toBeNull();
    expect(
      buildCustomerText(
        delivery('returned_to_restaurant'),
        'problem_at_door',
        'en',
      ),
    ).toBe('↩️ Order #1042 was returned to the restaurant');
  });
  it('the operator alert names the problem and the courier', () => {
    expect(buildDeliveryAlertText(1042, 'cannot_deliver', 'Bek <z>')).toContain(
      'Срочно: заказ №1042 снова готов и без курьера (курьер Bek &lt;z&gt;)',
    );
    expect(buildDeliveryAlertText(1042, 'no_answer', null)).toContain(
      'не может дозвониться',
    );
  });
});
