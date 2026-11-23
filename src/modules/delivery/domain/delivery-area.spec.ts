import {
  AreaPartInput,
  areaPartsProblems,
  customRing,
  DeliveryArea,
  inArea,
  MAX_CUSTOM_PARTS,
  MAX_CUSTOM_POINTS,
  parseRings,
} from './delivery-area';

const KNOWN = new Set(['UZ-TK', 'UZ-TO']);
const known = (code: string) => KNOWN.has(code);
const problems = (parts: AreaPartInput[]) => areaPartsProblems(parts, known);

// A triangle in Tashkent: [lat, lng]
const TRIANGLE = [
  [41.35, 69.2],
  [41.35, 69.35],
  [41.25, 69.3],
];
const custom = (polygon: unknown): AreaPartInput => ({
  source: 'custom',
  polygon,
});
const region = (code: string): AreaPartInput => ({ source: 'region', code });

describe('areaPartsProblems', () => {
  it('accepts known regions and a valid drawn part', () => {
    expect(
      problems([region('UZ-TK'), region('UZ-TO'), custom(TRIANGLE)]),
    ).toEqual([]);
  });

  it('unknown region code: unknown_region', () => {
    expect(problems([region('UZ-XX')])).toEqual([
      expect.objectContaining({
        field: 'parts[0].code',
        code: 'unknown_region',
      }),
    ]);
  });

  it('the same region twice: duplicate', () => {
    expect(problems([region('UZ-TK'), region('UZ-TK')])).toEqual([
      expect.objectContaining({ field: 'parts[1].code', code: 'duplicate' }),
    ]);
  });

  it('fewer than 3 or more than 200 points, or not pairs: polygon', () => {
    const many = Array.from({ length: MAX_CUSTOM_POINTS + 1 }, (_, i) => [
      41 + Math.cos(i) / 100,
      69 + Math.sin(i) / 100,
    ]);
    for (const polygon of [
      TRIANGLE.slice(0, 2),
      many,
      [[41.3, 69.2], [41.3], [41.2, 69.3]],
      'not a polygon',
    ])
      expect(problems([custom(polygon)])).toEqual([
        expect.objectContaining({ field: 'parts[0].polygon', code: 'polygon' }),
      ]);
  });

  it('lat and lng swapped (outside Uzbekistan): outside_bounds', () => {
    const swapped = TRIANGLE.map(([lat, lng]) => [lng, lat]);
    expect(problems([custom(swapped)])).toEqual([
      expect.objectContaining({ code: 'outside_bounds' }),
    ]);
  });

  it('an outline crossing itself: self_intersection', () => {
    const bowTie = [
      [41.2, 69.2],
      [41.3, 69.3],
      [41.3, 69.2],
      [41.2, 69.3],
    ];
    expect(problems([custom(bowTie)])).toEqual([
      expect.objectContaining({
        field: 'parts[0].polygon',
        code: 'self_intersection',
      }),
    ]);
  });

  it('two points equal after rounding to 6 decimals: self_intersection', () => {
    const almostSame = [
      [41.35, 69.2],
      [41.3500001, 69.2000001],
      [41.35, 69.35],
      [41.25, 69.3],
    ];
    expect(problems([custom(almostSame)])).toEqual([
      expect.objectContaining({ code: 'self_intersection' }),
    ]);
  });

  it('at most 10 drawn parts and 14 regions', () => {
    const drawn = Array.from({ length: MAX_CUSTOM_PARTS + 1 }, () =>
      custom(TRIANGLE),
    );
    expect(problems(drawn)).toEqual([
      expect.objectContaining({ field: 'parts', code: 'array_max_size' }),
    ]);
    const many = new Set(Array.from({ length: 15 }, (_, i) => `UZ-R${i}`));
    expect(
      areaPartsProblems([...many].map(region), (code) => many.has(code)),
    ).toEqual([
      expect.objectContaining({ field: 'parts', code: 'array_max_size' }),
    ]);
  });
});

describe('customRing', () => {
  it('rounds to 6 decimals', () => {
    expect(customRing([[41.12345678, 69.87654321]])).toEqual([
      [41.123457, 69.876543],
    ]);
    expect(customRing([[41, 'x']])).toBeNull();
  });
});

describe('inArea', () => {
  const area: DeliveryArea = {
    parts: [
      [customRing(TRIANGLE)!],
      [
        [
          [40, 71],
          [40, 72],
          [41, 72],
          [41, 71],
        ],
      ],
    ],
    defaultRule: {
      basePrice: 0,
      includedKm: 0,
      pricePerKm: 0,
      minOrder: 0,
      freeFrom: null,
    },
  };

  it('inside any part', () => {
    expect(inArea(area, [41.32, 69.28])).toBe(true);
    expect(inArea(area, [40.5, 71.5])).toBe(true);
    expect(inArea(area, [41.5, 69.28])).toBe(false);
  });
});

describe('parseRings', () => {
  it('keeps valid rings and refuses broken ones', () => {
    expect(parseRings([TRIANGLE])).toEqual([TRIANGLE]);
    expect(parseRings([])).toBeNull();
    expect(parseRings([[[41, 69]]])).toBeNull();
    expect(parseRings('x')).toBeNull();
  });
});
