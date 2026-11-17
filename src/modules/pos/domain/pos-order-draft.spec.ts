import {
  buildPosOrder,
  type DraftLinks,
  type DraftSource,
} from './pos-order-draft';

const order = (over: Partial<DraftSource> = {}): DraftSource => ({
  id: 'order-1',
  number: 12,
  fulfillment: 'delivery',
  phone: '+998901234567',
  comment: ' no onion ',
  customerName: 'Aziz',
  paymentMethod: 'cash',
  paymentStatus: 'not_required',
  total: 95_000,
  deliveryFee: 10_000,
  address: {
    id: 'a1',
    title: 'Home',
    address: 'Tashkent, Amir Temur 1',
    latitude: 41.3,
    longitude: 69.2,
    entrance: '2',
    floor: '3',
    apartment: '15',
    comment: 'gate code 12',
    isDefault: true,
    createdAt: '2026-11-01T00:00:00.000Z',
  },
  items: [
    {
      productId: 'pizza',
      basePrice: 30_000,
      quantity: 2,
      options: [
        // The size "large": +10 000 over the cheapest size
        { optionId: 'opt-large', price: 10_000 },
        { optionId: 'opt-cheese', price: 2_500 },
      ],
    },
  ],
  ...over,
});

const links = (over: Partial<DraftLinks> = {}): DraftLinks => ({
  terminalGroupId: 'tg1',
  addressFormat: 'city',
  street: null,
  products: new Map([['pizza', { externalId: 'i-pizza', sizeId: null }]]),
  options: new Map([
    [
      'opt-large',
      { kind: 'size', externalId: 'i-pizza:s-large', sizeId: 's-large' },
    ],
    [
      'opt-cheese',
      {
        kind: 'modifier',
        externalId: 'i-pizza/g-extra/m-cheese',
        sizeId: null,
      },
    ],
  ]),
  payments: new Map([
    ['cash', { id: 'pt-cash', kind: 'Cash' }],
    ['online', { id: 'pt-online', kind: 'Card' }],
  ]),
  deliveryItem: { id: 'i-delivery', sizeId: null },
  ...over,
});

const built = (o: DraftSource, l: DraftLinks) => {
  const r = buildPosOrder(o, l);
  if (!r.ok) throw new Error(r.problem);
  return r.draft;
};

describe('buildPosOrder', () => {
  it('a delivery: positions of the external menu, the size in the item price, modifiers, "Delivery" with its fee', () => {
    const d = built(order(), links());
    expect(d).toEqual({
      id: 'order-1',
      externalNumber: '12',
      terminalGroupId: 'tg1',
      kind: 'delivery',
      phone: '+998901234567',
      customerName: 'Aziz',
      comment: 'no onion',
      items: [
        {
          productId: 'i-pizza',
          sizeId: 's-large',
          amount: 2,
          price: 40_000,
          modifiers: [
            {
              productId: 'm-cheese',
              groupId: 'g-extra',
              amount: 1,
              price: 2_500,
            },
          ],
        },
        {
          productId: 'i-delivery',
          sizeId: null,
          amount: 1,
          price: 10_000,
          modifiers: [],
        },
      ],
      payment: {
        paymentTypeId: 'pt-cash',
        paymentTypeKind: 'Cash',
        sum: 95_000,
        processedExternally: false,
      },
      address: {
        format: 'city',
        line: 'Tashkent, Amir Temur 1',
        latitude: 41.3,
        longitude: 69.2,
        entrance: '2',
        floor: '3',
        flat: '15',
        comment: 'gate code 12',
      },
    });
    // iiko's sum of the positions is what the guest pays
    const sum = d.items.reduce(
      (s, i) =>
        s +
        (i.price + i.modifiers.reduce((m, x) => m + x.price * x.amount, 0)) *
          i.amount,
      0,
    );
    expect(sum).toBe(95_000);
  });

  it('only the guest data the kitchen and the delivery need: no address id, title or default flag', () => {
    const json = JSON.stringify(built(order(), links()));
    expect(json).not.toContain('"a1"');
    expect(json).not.toContain('Home');
    expect(json).not.toContain('isDefault');
  });

  it('free delivery: no "Delivery" position, and none needed', () => {
    const d = built(
      order({ deliveryFee: 0, total: 85_000 }),
      links({ deliveryItem: null }),
    );
    expect(d.items.map((i) => i.productId)).toEqual(['i-pizza']);
  });

  it('a fee without the "Delivery" item linked is refused', () => {
    expect(buildPosOrder(order(), links({ deliveryItem: null }))).toEqual({
      ok: false,
      problem: 'unmapped_delivery_item',
    });
  });

  it('pickup: DeliveryByClient, no address, no delivery fee', () => {
    const d = built(
      order({ fulfillment: 'pickup', deliveryFee: 0, address: null }),
      links(),
    );
    expect(d.kind).toBe('pickup');
    expect(d.address).toBeNull();
  });

  it('a single-size item names its size; a modifier group without an iiko id goes without one', () => {
    const d = built(
      order({
        deliveryFee: 0,
        items: [
          {
            productId: 'pizza',
            basePrice: 30_000,
            quantity: 1,
            options: [{ optionId: 'opt-x', price: 1_000 }],
          },
        ],
      }),
      links({
        products: new Map([
          ['pizza', { externalId: 'i-pizza', sizeId: 's-one' }],
        ]),
        options: new Map([
          [
            'opt-x',
            {
              kind: 'modifier',
              externalId: 'i-pizza/i-pizza#0/m-x',
              sizeId: null,
            },
          ],
        ]),
      }),
    );
    expect(d.items[0]).toMatchObject({
      sizeId: 's-one',
      modifiers: [{ productId: 'm-x', groupId: '' }],
    });
  });

  it('online payment is "online" and processed externally once paid; Click and Payme alike', () => {
    for (const method of ['click', 'payme'] as const) {
      const d = built(
        order({ paymentMethod: method, paymentStatus: 'paid' }),
        links(),
      );
      expect(d.payment).toMatchObject({
        paymentTypeId: 'pt-online',
        processedExternally: true,
      });
    }
  });

  it('a payment method without a link is refused', () => {
    expect(buildPosOrder(order({ paymentMethod: 'card' }), links())).toEqual({
      ok: false,
      problem: 'unmapped_payment',
    });
  });

  it('a dish or an option without a link to iiko is refused', () => {
    expect(buildPosOrder(order(), links({ products: new Map() }))).toEqual({
      ok: false,
      problem: 'unmapped_item',
    });
    expect(
      buildPosOrder(
        order({
          items: [
            {
              productId: null,
              basePrice: 1,
              quantity: 1,
              options: [],
            },
          ],
        }),
        links(),
      ),
    ).toEqual({ ok: false, problem: 'unmapped_item' });
    expect(buildPosOrder(order(), links({ options: new Map() }))).toEqual({
      ok: false,
      problem: 'unmapped_item',
    });
  });

  it('streets from the iiko directory: without a picked street the operator picks one', () => {
    expect(buildPosOrder(order(), links({ addressFormat: 'legacy' }))).toEqual({
      ok: false,
      problem: 'needs_street',
    });
    expect(buildPosOrder(order(), links({ addressFormat: 'unknown' }))).toEqual(
      { ok: false, problem: 'needs_street' },
    );
    const d = built(
      order(),
      links({ addressFormat: 'legacy', street: { id: 'st-1', house: '12A' } }),
    );
    expect(d.address).toMatchObject({
      format: 'legacy',
      streetId: 'st-1',
      house: '12A',
      flat: '15',
    });
  });

  it('a guest without a name goes under the order number', () => {
    expect(built(order({ customerName: null }), links()).customerName).toBe(
      'Xmenu #12',
    );
  });
});
