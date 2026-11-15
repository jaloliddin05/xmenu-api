import { computeTotals, hashOrderRequest, toSum } from './order-money';

describe('money', () => {
  it('totals', () => {
    expect(computeTotals(97000, 16000)).toEqual({
      subtotal: 97000,
      deliveryFee: 16000,
      discount: 0,
      total: 113000,
    });
    expect(computeTotals(1000, 0, 5000).total).toBe(0); // never negative
  });
  it('rounds fractional prices to whole sum', () => {
    expect(toSum(28000)).toBe(28000);
    expect(toSum(1999.6)).toBe(2000);
  });
});

describe('hashOrderRequest', () => {
  const base = {
    fulfillmentMode: 'delivery',
    branchId: 'b1',
    addressId: 'a1',
    phone: '+998901234567',
    paymentMethod: 'click',
    expectedTotal: 100,
    items: [
      {
        itemId: 'p1',
        quantity: 2,
        modifiers: [
          { groupId: 'g1', optionIds: ['x', 'y'] },
          { groupId: 'g0', optionIds: ['z'] },
        ],
      },
    ],
  };

  it('is stable regardless of option/group order', () => {
    const same = {
      ...base,
      items: [
        {
          itemId: 'p1',
          quantity: 2,
          modifiers: [
            { groupId: 'g0', optionIds: ['z'] },
            { groupId: 'g1', optionIds: ['y', 'x'] },
          ],
        },
      ],
    };
    expect(hashOrderRequest(same)).toBe(hashOrderRequest(base));
  });

  it('changes when anything meaningful changes', () => {
    const h = hashOrderRequest(base);
    expect(hashOrderRequest({ ...base, expectedTotal: 101 })).not.toBe(h);
    expect(hashOrderRequest({ ...base, paymentMethod: 'cash' })).not.toBe(h);
    expect(
      hashOrderRequest({ ...base, items: [{ ...base.items[0], quantity: 3 }] }),
    ).not.toBe(h);
    expect(hashOrderRequest({ ...base, comment: 'x' })).not.toBe(h);
    expect(hashOrderRequest({ ...base, expectedDeliveryFee: 5000 })).not.toBe(
      h,
    );
    expect(hashOrderRequest({ ...base, cashChangeFrom: 200000 })).not.toBe(h);
  });
});
