import {
  deliveryPaymentKinds,
  deliveryPaymentMethods,
  deliveryPaymentProblems,
  doorPaymentChoices,
  doorPaymentMethods,
  isOnlineMethod,
  paidAtDoor,
  pickupPaymentMethods,
  providerDisableLeavesNoMethod,
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

describe('saving the switches or the courier mode', () => {
  const OFF = { cash: true, card: false, online: false };
  const NO_KEYS = new Set<string>();
  const own = (deliveryPayment: typeof OFF) => ({
    courierMode: 'own' as const,
    deliveryPayment,
  });

  it('online cannot be switched on without a connected provider', () => {
    expect(
      deliveryPaymentProblems(own({ ...OFF, online: true }), OFF, NO_KEYS),
    ).toEqual([
      expect.objectContaining({
        field: 'deliveryPayment.online',
        code: 'online_payment_not_connected',
      }),
    ]);
    expect(
      deliveryPaymentProblems(own({ ...OFF, online: true }), OFF, KEYS),
    ).toEqual([]);
  });

  it('online already on stays savable after the provider was disabled while another method is left', () => {
    const on = { ...OFF, online: true };
    expect(deliveryPaymentProblems(own(on), on, NO_KEYS)).toEqual([]);
  });

  it('at least one switch stays on', () => {
    expect(
      deliveryPaymentProblems(
        own({ cash: false, card: false, online: false }),
        OFF,
        KEYS,
      ),
    ).toEqual([
      expect.objectContaining({
        field: 'deliveryPayment',
        code: 'delivery_payment_required',
      }),
    ]);
  });

  // W13F-04: the switches are on, but the guest would be left nothing
  it.each([
    // (a) only online, its provider was disabled since
    [
      'own',
      { cash: false, card: false, online: true },
      { cash: false, card: false, online: true },
      'deliveryPayment',
    ],
    // (b) only external services deliver, only cash and card are on
    ['external', OFF, OFF, 'courierMode'],
    ['external', { cash: true, card: true, online: false }, OFF, 'courierMode'],
    // (c) external services and online on, but no provider (online was on before)
    [
      'external',
      { cash: false, card: false, online: true },
      { cash: false, card: false, online: true },
      'deliveryPayment',
    ],
    // (b) and (c) at once: cash would work with own couriers, so the mode is the cause
    [
      'external',
      { cash: true, card: false, online: true },
      { cash: true, card: false, online: true },
      'courierMode',
    ],
  ] as const)(
    'courier mode %s, switches %j (before %j), no keys: delivery_payment_none_available on %s',
    (courierMode, next, previous, field) => {
      expect(
        deliveryPaymentProblems(
          { courierMode, deliveryPayment: next },
          previous,
          NO_KEYS,
        ),
      ).toEqual([
        expect.objectContaining({
          field,
          code: 'delivery_payment_none_available',
        }),
      ]);
    },
  );

  it('online with a provider keeps external services savable; both keeps cash', () => {
    const online = { cash: false, card: false, online: true };
    expect(
      deliveryPaymentProblems(
        { courierMode: 'external', deliveryPayment: online },
        online,
        new Set(['payme']),
      ),
    ).toEqual([]);
    expect(
      deliveryPaymentProblems(
        { courierMode: 'both', deliveryPayment: OFF },
        OFF,
        NO_KEYS,
      ),
    ).toEqual([]);
  });

  it('online switched on without keys is reported once, not twice', () => {
    expect(
      deliveryPaymentProblems(
        own({ cash: false, card: false, online: true }),
        OFF,
        NO_KEYS,
      ).map((p) => p.code),
    ).toEqual(['online_payment_not_connected']);
  });
});

describe('disabling a provider', () => {
  const ONLINE = { cash: false, card: false, online: true };

  it.each([
    // the last online provider is the only method: refused
    ['own', ONLINE, ['click'], 'click', true],
    ['external', { ...ONLINE, cash: true }, ['payme'], 'payme', true],
    // another provider stays
    ['own', ONLINE, ['click', 'payme'], 'click', false],
    // cash stays
    ['own', { ...ONLINE, cash: true }, ['click'], 'click', false],
    // online is switched off: the provider gives the guest nothing
    [
      'external',
      { cash: false, card: false, online: false },
      ['click'],
      'click',
      false,
    ],
    // already nothing to offer (the provider is not enabled): not made worse
    ['own', ONLINE, ['payme'], 'click', false],
  ] as const)(
    'courier mode %s, switches %j, providers %j, disabling %s → refused %p',
    (courierMode, deliveryPayment, providers, provider, refused) => {
      expect(
        providerDisableLeavesNoMethod(
          { courierMode, deliveryPayment },
          new Set(providers),
          provider,
        ),
      ).toBe(refused);
    },
  );
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
