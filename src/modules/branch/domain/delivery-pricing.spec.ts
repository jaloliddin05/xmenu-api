import {
  DeliveryRules,
  distanceFee,
  distanceKm,
  DistanceRule,
  LatLng,
  parseZone,
  pointInPolygon,
  priceDelivery,
  rateFor,
  roundUpToStep,
  ZoneRule,
} from './delivery-pricing';

// A square around central Tashkent
const square: LatLng[] = [
  [41.2, 69.1],
  [41.2, 69.4],
  [41.4, 69.4],
  [41.4, 69.1],
];
// A smaller square inside it
const inner: LatLng[] = [
  [41.28, 69.22],
  [41.28, 69.28],
  [41.32, 69.28],
  [41.32, 69.22],
];
const BRANCH: LatLng = [41.3, 69.25];
// About 0.0089932 degrees of latitude per km
const north = (km: number): LatLng => [BRANCH[0] + km / 111.19508, BRANCH[1]];

const zone = (over: Partial<ZoneRule> = {}): ZoneRule => ({
  polygon: square,
  price: 10000,
  minOrder: 0,
  freeFrom: null,
  ...over,
});
const distance = (over: Partial<DistanceRule> = {}): DistanceRule => ({
  basePrice: 8000,
  includedKm: 2,
  pricePerKm: 1500,
  maxKm: 10,
  minOrder: 30000,
  freeFrom: null,
  ...over,
});
const rules = (r: Partial<DeliveryRules>): DeliveryRules => ({
  zones: [],
  distance: null,
  ...r,
});

describe('pointInPolygon', () => {
  it('inside / outside', () => {
    expect(pointInPolygon(41.3, 69.25, square)).toBe(true);
    expect(pointInPolygon(41.5, 69.25, square)).toBe(false);
    expect(pointInPolygon(41.3, 69.5, square)).toBe(false);
  });

  it('works for a concave polygon (notch is outside)', () => {
    const c: LatLng[] = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 6],
      [4, 6],
      [4, 4],
      [10, 4],
      [10, 0],
    ];
    expect(pointInPolygon(5, 5, c)).toBe(false); // in the notch
    expect(pointInPolygon(2, 2, c)).toBe(true);
  });
});

describe('parseZone', () => {
  it('accepts a valid polygon', () =>
    expect(parseZone(square)).toEqual(square));
  it.each([
    null,
    undefined,
    'x',
    [],
    [
      [1, 2],
      [3, 4],
    ],
    [
      [1, 2],
      [3, 4],
      ['a', 5],
    ],
    [
      [1, 2, 3],
      [1, 2],
      [3, 4],
    ],
  ])('rejects %p', (v) => expect(parseZone(v)).toBeNull());
});

describe('distanceKm', () => {
  it('measures a straight line (Tashkent to Samarkand is about 266 km)', () => {
    expect(distanceKm([41.3111, 69.2797], [39.6542, 66.9597])).toBeCloseTo(
      266,
      -1,
    );
  });
  it('is zero for the same point and symmetric', () => {
    expect(distanceKm(BRANCH, BRANCH)).toBe(0);
    expect(distanceKm(BRANCH, north(3))).toBeCloseTo(
      distanceKm(north(3), BRANCH),
      9,
    );
    expect(distanceKm(BRANCH, north(3))).toBeCloseTo(3, 3);
  });
});

describe('rateFor', () => {
  it('a zone wins over the distance rule', () => {
    expect(
      rateFor(
        rules({ zones: [zone()], distance: distance() }),
        BRANCH,
        north(1),
      ),
    ).toMatchObject({ rule: 'zone', zoneIndex: 0 });
  });

  it('overlapping zones: the first in the owner order wins', () => {
    const r = rules({
      zones: [zone({ polygon: square }), zone({ polygon: inner })],
    });
    expect(rateFor(r, BRANCH, [41.3, 69.25])).toMatchObject({ zoneIndex: 0 });
    const swapped = rules({
      zones: [zone({ polygon: inner }), zone({ polygon: square })],
    });
    expect(rateFor(swapped, BRANCH, [41.3, 69.25])).toMatchObject({
      zoneIndex: 0,
    });
    // Outside the inner zone, inside the big one: the second zone applies
    expect(rateFor(swapped, BRANCH, [41.35, 69.25])).toMatchObject({
      zoneIndex: 1,
    });
  });

  it('outside every zone but within max distance: the distance rule', () => {
    const r = rules({
      zones: [zone({ polygon: inner })],
      distance: distance(),
    });
    expect(rateFor(r, BRANCH, north(5))).toMatchObject({ rule: 'distance' });
  });

  it('max distance is inclusive: exactly at the boundary delivers, just over does not', () => {
    const r = rules({ distance: distance({ maxKm: 5 }) });
    const at = north(5);
    expect(distanceKm(BRANCH, at)).toBeCloseTo(5, 3);
    const exact = rules({
      distance: distance({ maxKm: distanceKm(BRANCH, at) }),
    });
    expect(rateFor(exact, BRANCH, at)).toMatchObject({ rule: 'distance' });
    expect(rateFor(r, BRANCH, north(5.01))).toBeNull();
  });

  it('no rule covers the address: null', () => {
    expect(rateFor(rules({ zones: [zone()] }), BRANCH, [42, 70])).toBeNull();
    expect(rateFor(rules({}), BRANCH, BRANCH)).toBeNull();
  });
});

describe('distanceFee', () => {
  it('within the included km: the base price', () => {
    expect(distanceFee(distance(), 0)).toBe(8000);
    expect(distanceFee(distance(), 2)).toBe(8000);
  });
  it('charges every started kilometre over the included ones', () => {
    expect(distanceFee(distance(), 2.01)).toBe(9500);
    expect(distanceFee(distance(), 3)).toBe(9500);
    expect(distanceFee(distance(), 3.2)).toBe(11000);
  });
  it('ignores float noise at a whole kilometre', () => {
    expect(distanceFee(distance(), 3.0000000000001)).toBe(9500);
  });
});

describe('roundUpToStep', () => {
  it.each([
    [7300, 100, 7300],
    [7301, 100, 7400],
    [7300, 500, 7500],
    [7500, 500, 7500],
    [7300, 1000, 8000],
    [0, 1000, 0],
  ])('%d at step %d is %d', (fee, step, expected) =>
    expect(roundUpToStep(fee, step)).toBe(expected),
  );
});

describe('priceDelivery', () => {
  const zoneRules = rules({
    zones: [zone({ price: 7300, minOrder: 50000, freeFrom: 150000 })],
  });
  const zoneRate = { rule: 'zone' as const, zoneIndex: 0, distanceKm: 1 };

  it('zone price rounded up to the venue step', () => {
    expect(priceDelivery(zoneRules, zoneRate, 60000, 500)).toEqual({
      rule: 'zone',
      zoneIndex: 0,
      distanceKm: 1,
      deliveryFee: 7500,
      freeFrom: 150000,
      minOrder: 50000,
      shortBy: 0,
    });
  });

  it('free from the threshold (inclusive), paid just below it', () => {
    expect(priceDelivery(zoneRules, zoneRate, 150000, 100).deliveryFee).toBe(0);
    expect(priceDelivery(zoneRules, zoneRate, 149999, 100).deliveryFee).toBe(
      7300,
    );
  });

  it('no threshold: never free', () => {
    const r = rules({ zones: [zone({ price: 5000 })] });
    expect(priceDelivery(r, zoneRate, 10_000_000, 100).deliveryFee).toBe(5000);
  });

  it('minimum of the applied rule: shortBy is what is missing', () => {
    expect(priceDelivery(zoneRules, zoneRate, 42000, 100).shortBy).toBe(8000);
    expect(priceDelivery(zoneRules, zoneRate, 50000, 100).shortBy).toBe(0);
  });

  it('distance rule: its price, minimum and threshold', () => {
    const r = rules({
      zones: [zone({ minOrder: 1 })],
      distance: distance({ freeFrom: 200000 }),
    });
    const rate = { rule: 'distance' as const, distanceKm: 3.2 };
    expect(priceDelivery(r, rate, 10000, 1000)).toMatchObject({
      rule: 'distance',
      zoneIndex: null,
      deliveryFee: 11000,
      minOrder: 30000,
      shortBy: 20000,
    });
    expect(priceDelivery(r, rate, 200000, 1000).deliveryFee).toBe(0);
  });
});
