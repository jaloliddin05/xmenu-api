import {
  deliveryPaymentKinds,
  deliveryPaymentMethods,
  deliveryPaymentProblems,
  doorPaymentChoices,
  doorPaymentMethods,
  isOnlineMethod,
  paidAtDoor,
  pickupPaymentMethods,
} from './delivery-payment';

const ALL_ON = { cash: true, card: true, online: true };
const KEYS = new Set(['click', 'payme']);

describe('payment methods at delivery (docs/DELIVERY.md, W13-05)', () => {
  it.each([
    ['own', ALL_ON, KEYS, ['cash', 'card', 'click', 'payme']],
    ['both', ALL_ON, new Set(['payme']), ['cash', 'card', 'payme']],
    // only external services deliver: nothing is paid at the door
    ['external', ALL_ON, KEYS, ['click', 'payme']],
    ['external', { cash: true, card: true, online: false }, KEYS, []],
    // online switched on, no keys: no online
    ['own', { cash: false, card: true, online: true }, new Set(), ['card']],
    // keys, but online switched off
    ['own', { cash: true, card: false, online: false }, KEYS, ['cash']],
  ] as const)(
    'courier mode %s, switches %j, providers %p → %j',
    (courierMode, deliveryPayment, providers, expected) => {
      expect(
        deliveryPaymentMethods({ courierMode, deliveryPayment }, providers),
      ).toEqual(expected);
    },
  );

  it('the guest sees kinds without provider names', () => {
    expect(deliveryPaymentKinds(['cash', 'click', 'payme'])).toEqual([
      'cash',
      'online',
    ]);
    expect(deliveryPaymentKinds(['card'])).toEqual(['card']);
    expect(deliveryPaymentKinds([])).toEqual([]);
  });

  it('pickup is not governed by the switches: cash always, online with keys, never a card', () => {
    expect(pickupPaymentMethods(new Set())).toEqual(['cash']);
    expect(pickupPaymentMethods(new Set(['click']))).toEqual(['cash', 'click']);
  });

  it('cash and card are paid at the door, click and payme online', () => {
    expect(['cash', 'card', 'click', 'payme'].map(paidAtDoor)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(['cash', 'card', 'click', 'payme'].map(isOnlineMethod)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });
});

describe('saving the switches', () => {
  const OFF = { cash: true, card: false, online: false };

  it('online cannot be switched on without a connected provider', () => {
    expect(
      deliveryPaymentProblems({ ...OFF, online: true }, OFF, false),
    ).toEqual([
      expect.objectContaining({
        field: 'deliveryPayment.online',
        code: 'online_payment_not_connected',
      }),
    ]);
    expect(
      deliveryPaymentProblems({ ...OFF, online: true }, OFF, true),
    ).toEqual([]);
  });

  it('online already on stays savable after the provider was disabled (it just drops out of the list)', () => {
    const on = { ...OFF, online: true };
    expect(deliveryPaymentProblems(on, on, false)).toEqual([]);
  });

  it('at least one method stays on', () => {
    expect(
      deliveryPaymentProblems(
        { cash: false, card: false, online: false },
        OFF,
        true,
      ),
    ).toEqual([
      expect.objectContaining({
        field: 'deliveryPayment',
        code: 'delivery_payment_required',
      }),
    ]);
  });
});

describe('payment buttons of the courier', () => {
  it('the door methods follow the switches and the courier mode', () => {
    expect(
      doorPaymentMethods({ courierMode: 'own', deliveryPayment: ALL_ON }),
    ).toEqual(['cash', 'card']);
    expect(
      doorPaymentMethods({ courierMode: 'external', deliveryPayment: ALL_ON }),
    ).toEqual([]);
  });

  it('the chosen method first, the other one only if the venue takes it now; online: none', () => {
    expect(doorPaymentChoices('cash', ['cash', 'card'])).toEqual([
      'cash',
      'card',
    ]);
    expect(doorPaymentChoices('card', ['cash', 'card'])).toEqual([
      'card',
      'cash',
    ]);
    expect(doorPaymentChoices('cash', ['cash'])).toEqual(['cash']);
    // switched off after the order: the chosen method can still be marked
    expect(doorPaymentChoices('card', [])).toEqual(['card']);
    expect(doorPaymentChoices('click', ['cash', 'card'])).toEqual([]);
  });
});
