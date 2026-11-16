import {
  CourierCardOrder,
  encodeCourierAction,
  parseCourierAction,
  renderCourierCard,
} from './courier-card';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const ME = 'courier-me';

const order = (o: Partial<CourierCardOrder> = {}): CourierCardOrder => ({
  id: ORDER_ID,
  number: 1042,
  status: 'ready',
  courierId: ME,
  doorProblem: null,
  doorProblemReason: null,
  branch: { id: BRANCH_ID, title: 'Chilonzor', address: 'Bunyodkor 1' },
  guestName: 'Aziza',
  phone: '+998901112233',
  address: {
    address: 'Amir Temur 5',
    latitude: 41.31,
    longitude: 69.28,
    entrance: '2',
    floor: '4',
    apartment: '17',
    comment: 'Domofon 17',
  },
  comment: 'Bez luka',
  items: [
    { name: 'Plov', quantity: 2 },
    { name: 'Choy', quantity: 1 },
  ],
  total: 125000,
  currency: 'UZS',
  paymentMethod: 'cash',
  cashChangeFrom: 200000,
  ...o,
});

const BOTH = ['cash', 'card'] as const;
const card = (
  o: Partial<CourierCardOrder> = {},
  readyFromBranch = 1,
  doorMethods: readonly ('cash' | 'card')[] = BOTH,
) =>
  renderCourierCard(order(o), {
    courierId: ME,
    lang: 'ru',
    readyFromBranch,
    doorMethods,
  });
const buttons = (c: ReturnType<typeof card>) =>
  (c.keyboard?.inline_keyboard ?? []).flat().map((b) => b.text);

describe('courier card', () => {
  it('shows everything the courier needs: branch, guest, address with details, map, items, cash and change', () => {
    const { text } = card({ status: 'on_the_way' });
    for (const part of [
      'Заказ №1042',
      'Chilonzor, Bunyodkor 1',
      'Amir Temur 5, подъезд 2, этаж 4, кв. 17',
      'Domofon 17',
      'https://yandex.uz/maps/?pt=69.28,41.31',
      'Aziza, +998901112233',
      'Plov × 2; Choy × 1',
      '125 000 сум (наличные)',
      'Сдача с: 200 000 сум',
    ])
      expect(text).toContain(part);
  });

  it('assigned, still cooking: the card without buttons', () => {
    expect(card({ status: 'accepted' }).keyboard).toBeNull();
  });

  it('ready: "picked up", and "picked up all" only for several ready orders of the branch', () => {
    expect(buttons(card({ status: 'ready' }))).toEqual(['📦 Забрал']);
    expect(buttons(card({ status: 'ready' }, 3))).toEqual([
      '📦 Забрал',
      '📦 Забрал все (3)',
    ]);
    const all = card({ status: 'ready' }, 3).keyboard!.inline_keyboard[1][0];
    expect(parseCourierAction(all.callback_data)).toEqual({
      a: 'pick_all',
      branchId: BRANCH_ID,
    });
  });

  it('on the way, cash: "delivered, cash received", "delivered, paid by card" and the three problem buttons', () => {
    expect(buttons(card({ status: 'on_the_way' }))).toEqual([
      '✅ Доставил, деньги получены',
      '💳 Доставил, оплачено картой',
      '📵 Не дозвонился',
      '🚫 Отказ гостя',
      '⚠️ Не могу доставить',
    ]);
  });

  it('the venue takes no card now: a cash order shows only "cash received" (W13-05)', () => {
    expect(buttons(card({ status: 'on_the_way' }, 1, ['cash']))).toEqual([
      '✅ Доставил, деньги получены',
      '📵 Не дозвонился',
      '🚫 Отказ гостя',
      '⚠️ Не могу доставить',
    ]);
  });

  it('a card to the courier: the total to collect, "paid by card" first, cash only if the venue takes it', () => {
    const c = card({
      status: 'on_the_way',
      paymentMethod: 'card',
      cashChangeFrom: null,
    });
    expect(c.text).toContain('125 000 сум (картой курьеру)');
    expect(buttons(c).slice(0, 3)).toEqual([
      '💳 Доставил, оплачено картой',
      '✅ Доставил, деньги получены',
      '📵 Не дозвонился',
    ]);
    const cardOnly = card({ status: 'on_the_way', paymentMethod: 'card' }, 1, [
      'card',
    ]);
    expect(buttons(cardOnly).slice(0, 2)).toEqual([
      '💳 Доставил, оплачено картой',
      '📵 Не дозвонился',
    ]);
    // the change line is for cash only
    expect(cardOnly.text).not.toContain('Сдача');
  });

  it('a method switched off after the order: the chosen one is still there to mark', () => {
    expect(
      buttons(card({ status: 'on_the_way', paymentMethod: 'card' }, 1, []))[0],
    ).toBe('💳 Доставил, оплачено картой');
  });

  it('on the way, paid online: "delivered", nothing to collect and no change line', () => {
    const c = card({
      status: 'on_the_way',
      paymentMethod: 'click',
      cashChangeFrom: null,
    });
    expect(buttons(c).slice(0, 2)).toEqual(['✅ Доставил', '📵 Не дозвонился']);
    expect(c.text).toContain('0 сум (оплачен онлайн)');
    expect(c.text).not.toContain('Сдача');
  });

  it('the refusal reasons menu, then back', () => {
    const c = renderCourierCard(order({ status: 'on_the_way' }), {
      courierId: ME,
      lang: 'ru',
      readyFromBranch: 0,
      refuseMenu: true,
      doorMethods: BOTH,
    });
    expect(buttons(c)).toEqual([
      'Передумал',
      'Не тот заказ',
      'Недоволен качеством',
      'Другое',
      '← Назад',
    ]);
    expect(
      parseCourierAction(c.keyboard!.inline_keyboard[0][0].callback_data),
    ).toEqual({
      a: 'refused',
      orderId: ORDER_ID,
      reason: 'changed_mind',
    });
  });

  it('no answer: only "delivered" (the guest may still answer); refused: no buttons, the reason shown', () => {
    expect(
      buttons(card({ status: 'problem_at_door', doorProblem: 'no_answer' })),
    ).toEqual(['✅ Доставил, деньги получены', '💳 Доставил, оплачено картой']);
    const refused = card({
      status: 'problem_at_door',
      doorProblem: 'refused',
      doorProblemReason: 'wrong_order',
    });
    expect(refused.keyboard).toBeNull();
    expect(refused.text).toContain('Причина: Не тот заказ');
  });

  it.each([
    ['completed', ME, '✅ Доставлен'],
    ['cancelled', ME, '❌ Отменён'],
    ['returned_to_restaurant', ME, '↩️ Возвращён в ресторан'],
    ['handed_to_external', ME, '↗️ Передан внешней службе'],
    ['ready', 'someone-else', '➖ Снят с вас'],
    ['ready', null, '➖ Снят с вас'],
  ] as const)(
    'finished (%s, courier %s): number and result only, the guest phone and address removed',
    (status, courierId, result) => {
      const c = card({ status, courierId });
      expect(c.final).toBe(true);
      expect(c.keyboard).toBeNull();
      expect(c.text).toBe(`Заказ №1042\n${result}`);
      expect(c.text).not.toContain('+998');
      expect(c.text).not.toContain('Amir Temur');
    },
  );

  it('speaks the courier language', () => {
    const uz = renderCourierCard(order({ status: 'on_the_way' }), {
      courierId: ME,
      lang: 'uz',
      readyFromBranch: 0,
      doorMethods: BOTH,
    });
    expect(uz.text).toContain('№1042 buyurtma');
    expect(uz.text).toContain("125 000 so'm (naqd)");
    const en = renderCourierCard(order({ status: 'ready' }), {
      courierId: ME,
      lang: 'en',
      readyFromBranch: 1,
      doorMethods: BOTH,
    });
    expect(buttons(en)).toEqual(['📦 Picked up']);
  });
});

describe('courier button data', () => {
  it('round-trips every action within 64 bytes', () => {
    const actions = [
      { a: 'pick', orderId: ORDER_ID },
      { a: 'pick_all', branchId: BRANCH_ID },
      { a: 'delivered', orderId: ORDER_ID },
      { a: 'no_answer', orderId: ORDER_ID },
      { a: 'refuse_menu', orderId: ORDER_ID },
      { a: 'refused', orderId: ORDER_ID, reason: 'changed_mind' },
      { a: 'back', orderId: ORDER_ID },
      { a: 'cannot_deliver', orderId: ORDER_ID },
      { a: 'delivered_card', orderId: ORDER_ID },
    ] as const;
    for (const action of actions) {
      const data = encodeCourierAction(action);
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
      expect(parseCourierAction(data)).toEqual(action);
    }
  });

  it.each([
    undefined,
    '',
    'o:a:' + ORDER_ID,
    'cr:xx:' + ORDER_ID,
    'cr:pk:not-a-uuid',
    'cr:pk:' + ORDER_ID + ':extra',
    'cr:rf:' + ORDER_ID,
    'cr:rf:' + ORDER_ID + ':made_up',
  ])('refuses forged data %p', (data) => {
    expect(parseCourierAction(data)).toBeNull();
  });
});
