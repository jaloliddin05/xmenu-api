import { computeTotals, hashOrderRequest, parseZone, pointInPolygon, toSum } from './order-money';

// Toshkent markazi atrofida kvadrat zona
const zone: [number, number][] = [
  [41.2, 69.1],
  [41.2, 69.4],
  [41.4, 69.4],
  [41.4, 69.1],
];

describe('pointInPolygon', () => {
  it('inside / outside', () => {
    expect(pointInPolygon(41.3, 69.25, zone)).toBe(true);
    expect(pointInPolygon(41.5, 69.25, zone)).toBe(false);
    expect(pointInPolygon(41.3, 69.5, zone)).toBe(false);
  });

  it('works for a concave polygon (notch is outside)', () => {
    const c: [number, number][] = [[0, 0], [0, 10], [10, 10], [10, 6], [4, 6], [4, 4], [10, 4], [10, 0]];
    expect(pointInPolygon(5, 5, c)).toBe(false); // in the notch
    expect(pointInPolygon(2, 2, c)).toBe(true);
  });
});

describe('parseZone', () => {
  it('accepts a valid polygon', () => expect(parseZone(zone)).toEqual(zone));
  it.each([null, undefined, 'x', [], [[1, 2], [3, 4]], [[1, 2], [3, 4], ['a', 5]], [[1, 2, 3], [1, 2], [3, 4]]])(
    'rejects %p (zone is then not enforced)',
    (v) => expect(parseZone(v)).toBeNull(),
  );
});

describe('money', () => {
  it('totals', () => {
    expect(computeTotals(97000, 16000)).toEqual({ subtotal: 97000, serviceFee: 16000, discount: 0, total: 113000 });
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
    items: [{ itemId: 'p1', quantity: 2, modifiers: [{ groupId: 'g1', optionIds: ['x', 'y'] }, { groupId: 'g0', optionIds: ['z'] }] }],
  };

  it('is stable regardless of option/group order', () => {
    const same = {
      ...base,
      items: [{ itemId: 'p1', quantity: 2, modifiers: [{ groupId: 'g0', optionIds: ['z'] }, { groupId: 'g1', optionIds: ['y', 'x'] }] }],
    };
    expect(hashOrderRequest(same)).toBe(hashOrderRequest(base));
  });

  it('changes when anything meaningful changes', () => {
    const h = hashOrderRequest(base);
    expect(hashOrderRequest({ ...base, expectedTotal: 101 })).not.toBe(h);
    expect(hashOrderRequest({ ...base, paymentMethod: 'cash' })).not.toBe(h);
    expect(hashOrderRequest({ ...base, items: [{ ...base.items[0], quantity: 3 }] })).not.toBe(h);
    expect(hashOrderRequest({ ...base, comment: 'x' })).not.toBe(h);
  });
});
