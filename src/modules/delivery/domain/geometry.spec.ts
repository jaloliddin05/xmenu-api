import {
  LatLng,
  pointInRings,
  Ring,
  ringsBbox,
  ringsIntersect,
  roundRing,
  selfIntersects,
} from './geometry';

// Squares by their south-west corner and side, in degrees: [lat, lng]
const square = (lat: number, lng: number, side: number): Ring => [
  [lat, lng],
  [lat, lng + side],
  [lat + side, lng + side],
  [lat + side, lng],
];

const OUTER = square(41, 69, 1);
const HOLE = square(41.4, 69.4, 0.2);
const EXCLAVE = square(43, 71, 0.5);

describe('pointInRings (even-odd over the rings of a part)', () => {
  const inside = (p: LatLng, rings: Ring[]) => pointInRings(p[0], p[1], rings);

  it('inside the outline', () => {
    expect(inside([41.1, 69.1], [OUTER])).toBe(true);
  });

  it('outside the outline', () => {
    expect(inside([40.9, 69.5], [OUTER])).toBe(false);
    expect(inside([41.5, 70.5], [OUTER])).toBe(false);
  });

  it('in a hole: outside the part', () => {
    expect(inside([41.5, 69.5], [OUTER, HOLE])).toBe(false);
    expect(inside([41.1, 69.1], [OUTER, HOLE])).toBe(true);
  });

  it('in an exclave: inside the part', () => {
    const rings = [OUTER, HOLE, EXCLAVE];
    expect(inside([43.2, 71.2], rings)).toBe(true);
    expect(inside([42.5, 70.5], rings)).toBe(false);
  });

  it('several parts: inside any one of them', () => {
    const parts = [[OUTER], [EXCLAVE]];
    const inArea = (p: LatLng) => parts.some((rings) => inside(p, rings));
    expect(inArea([41.5, 69.5])).toBe(true);
    expect(inArea([43.2, 71.2])).toBe(true);
    expect(inArea([42.5, 70.5])).toBe(false);
  });
});

describe('selfIntersects', () => {
  it('a plain polygon does not', () => {
    expect(selfIntersects(OUTER)).toBe(false);
    expect(
      selfIntersects([
        [41, 69],
        [41, 70],
        [41.5, 69.5],
      ]),
    ).toBe(false);
  });

  it('a bow tie does', () => {
    expect(
      selfIntersects([
        [41, 69],
        [42, 70],
        [42, 69],
        [41, 70],
      ]),
    ).toBe(true);
  });

  it('an edge touching another vertex does', () => {
    expect(
      selfIntersects([
        [41, 69],
        [41, 71],
        [42, 71],
        [41, 70],
        [42, 69],
      ]),
    ).toBe(true);
  });

  it('a repeated point and a spike folding back do', () => {
    expect(
      selfIntersects([
        [41, 69],
        [41, 70],
        [41, 70],
        [42, 70],
      ]),
    ).toBe(true);
    expect(
      selfIntersects([
        [41, 69],
        [41, 70],
        [41, 69.5],
        [42, 69.5],
      ]),
    ).toBe(true);
  });

  it('three points on a line (no area) do', () => {
    expect(
      selfIntersects([
        [41, 69],
        [41, 69.5],
        [41, 70],
      ]),
    ).toBe(true);
  });
});

describe('ringsIntersect', () => {
  it('a hole inside its outline does not touch it', () => {
    expect(ringsIntersect(OUTER, HOLE)).toBe(false);
  });

  it('overlapping and touching rings do', () => {
    expect(ringsIntersect(OUTER, square(41.5, 69.5, 1))).toBe(true);
    expect(ringsIntersect(OUTER, square(42, 69.2, 0.3))).toBe(true);
  });
});

describe('rounding and bbox', () => {
  it('roundRing keeps the given decimals', () => {
    expect(roundRing([[41.1234567, 69.7654321]], 6)).toEqual([
      [41.123457, 69.765432],
    ]);
    expect(roundRing([[41.1234567, 69.7654321]], 5)).toEqual([
      [41.12346, 69.76543],
    ]);
  });

  it('ringsBbox spans every ring', () => {
    expect(ringsBbox([OUTER, EXCLAVE])).toEqual([
      [41, 69],
      [43.5, 71.5],
    ]);
  });
});

// Shared with xmenu-backend geometry.spec.ts, xmenu-dashboard geometry.test.js and xmenu-client deliveryArea.test.js:
// the same rings, points and expectations in all three (edge and vertex cases follow the backend formula).
describe('shared cases', () => {
  const SKEW: Ring = [
    [0, 0],
    [1, 4],
    [3, 3],
    [2, -1],
  ];
  const SQ: Ring = [
    [0, 0],
    [0, 2],
    [2, 2],
    [2, 0],
  ];
  const SHARED_CASES: [string, LatLng, Ring, boolean][] = [
    ['skew ring, inside', [1.5, 1.5], SKEW, true],
    ['skew ring, outside', [0.2, 3], SKEW, false],
    ['at the latitude of a vertex, inside', [1, 3.9], SKEW, true],
    ['at the latitude of a vertex, outside', [1, 4.1], SKEW, false],
    ['at a vertex', [1, 4], SKEW, false],
    ['at the first vertex', [0, 0], SKEW, false],
    ['on the extension of a horizontal edge, right', [0, 3], SQ, false],
    ['on the extension of a horizontal edge, left', [0, -1], SQ, false],
    ['on the extension of the top edge, right', [2, 3], SQ, false],
    ['on the extension of the top edge, left', [2, -1], SQ, false],
    ['on the bottom edge', [0, 1], SQ, true],
    ['on the top edge', [2, 1], SQ, false],
    ['on the left edge', [1, 0], SQ, true],
    ['on the right edge', [1, 2], SQ, false],
  ];
  it.each(SHARED_CASES)('%s', (_name, point, ring, expected) => {
    expect(pointInRings(point[0], point[1], [ring])).toBe(expected);
  });
});
