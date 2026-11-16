import {
  courierPay,
  deliveryDistanceKm,
  effectiveRate,
  payRateOf,
} from './courier-pay';

const RATE = { perDelivery: 10_000, includedKm: 3, perKm: 2_000 };

describe('courier pay', () => {
  it('no rate: nothing accrued', () => {
    expect(courierPay(null, 12)).toBeNull();
  });

  it('within the included km: the delivery rate only', () => {
    expect(courierPay(RATE, 0)).toBe(10_000);
    expect(courierPay(RATE, 3)).toBe(10_000);
    // float noise does not start a kilometre
    expect(courierPay(RATE, 3.0000000001)).toBe(10_000);
  });

  it('every started km over the included ones', () => {
    expect(courierPay(RATE, 3.01)).toBe(12_000);
    expect(courierPay(RATE, 5.1)).toBe(16_000);
    expect(courierPay(RATE, 6)).toBe(16_000);
  });

  it('a stored rate is complete or none; the own one wins as a whole', () => {
    expect(
      payRateOf({ perDelivery: 1, includedKm: null, perKm: 1 }),
    ).toBeNull();
    expect(payRateOf({ perDelivery: 1, includedKm: 0, perKm: 0 })).toEqual({
      perDelivery: 1,
      includedKm: 0,
      perKm: 0,
    });
    const own = { perDelivery: 5, includedKm: 1, perKm: 1 };
    expect(effectiveRate(own, RATE)).toBe(own);
    expect(effectiveRate(null, RATE)).toBe(RATE);
    expect(effectiveRate(null, null)).toBeNull();
  });

  it('straight-line km from the branch; 0 without coordinates', () => {
    const branch = { latitude: 41.311, longitude: 69.279 };
    expect(
      deliveryDistanceKm(branch, { latitude: 41.356, longitude: 69.279 }),
    ).toBeCloseTo(5.0, 1);
    expect(deliveryDistanceKm(branch, { address: 'x' })).toBe(0);
    expect(deliveryDistanceKm(branch, null)).toBe(0);
  });
});
