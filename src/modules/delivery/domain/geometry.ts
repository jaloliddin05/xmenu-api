/**
 * Plane geometry of the venue delivery area (docs/DELIVERY.md, "Общая зона доставки заведения"). A ring is
 * [[lat, lng], ...], open (the last point is not a copy of the first). A part is a list of rings and contains a
 * point by the even-odd rule over all of them: holes and exclaves need no separate markup, and Yandex Maps
 * fills a Polygon of such rings the same way (fillRule evenOdd by default).
 *
 * Coordinates are treated as a plane (no latitude correction): enough for inside/outside and crossing tests.
 */

/** [lat, lng] */
export type LatLng = [number, number];
export type Ring = LatLng[];

/** Ray casting over one ring; a point exactly on an edge may land either way. */
export function pointInRing(lat: number, lng: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const crosses =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Even-odd over every ring of the part: inside an odd number of rings. */
export function pointInRings(lat: number, lng: number, rings: Ring[]): boolean {
  let inside = false;
  for (const ring of rings) if (pointInRing(lat, lng, ring)) inside = !inside;
  return inside;
}

/** Rounds to `digits` decimal places (6 is about 0.1 m, 5 about 1 m). */
export function roundCoord(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export const roundRing = (ring: Ring, digits: number): Ring =>
  ring.map(([lat, lng]) => [roundCoord(lat, digits), roundCoord(lng, digits)]);

/** Sign of the turn a → b → c: 1 left, -1 right, 0 collinear. */
function orientation(a: LatLng, b: LatLng, c: LatLng): number {
  const v = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** c lies on segment a–b, given the three are collinear. */
const onSegment = (a: LatLng, b: LatLng, c: LatLng) =>
  Math.min(a[0], b[0]) <= c[0] &&
  c[0] <= Math.max(a[0], b[0]) &&
  Math.min(a[1], b[1]) <= c[1] &&
  c[1] <= Math.max(a[1], b[1]);

/** Segments p1–p2 and q1–q2 share at least one point (touching counts). */
export function segmentsIntersect(
  p1: LatLng,
  p2: LatLng,
  q1: LatLng,
  q2: LatLng,
): boolean {
  const o1 = orientation(p1, p2, q1);
  const o2 = orientation(p1, p2, q2);
  const o3 = orientation(q1, q2, p1);
  const o4 = orientation(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && onSegment(p1, p2, q1)) ||
    (o2 === 0 && onSegment(p1, p2, q2)) ||
    (o3 === 0 && onSegment(q1, q2, p1)) ||
    (o4 === 0 && onSegment(q1, q2, p2))
  );
}

interface Segment {
  a: LatLng;
  b: LatLng;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

function segments(ring: Ring): Segment[] {
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return {
      a,
      b,
      minLat: Math.min(a[0], b[0]),
      maxLat: Math.max(a[0], b[0]),
      minLng: Math.min(a[1], b[1]),
      maxLng: Math.max(a[1], b[1]),
    };
  });
}

const boxesOverlap = (s: Segment, t: Segment) =>
  s.minLat <= t.maxLat &&
  t.minLat <= s.maxLat &&
  s.minLng <= t.maxLng &&
  t.minLng <= s.maxLng;

/**
 * The ring crosses or touches itself: two edges that are not neighbours share a point, or two neighbours fold
 * back over each other. A repeated point counts (the edges around it touch).
 */
export function selfIntersects(ring: Ring): boolean {
  const n = ring.length;
  if (n < 3) return false;
  const segs = segments(ring);
  for (let i = 0; i < n; i++) {
    const s = segs[i];
    // Neighbours share an endpoint; they only fail when they fold back (collinear and overlapping)
    const next = segs[(i + 1) % n];
    if (
      orientation(s.a, s.b, next.b) === 0 &&
      (onSegment(s.a, s.b, next.b) || onSegment(next.a, next.b, s.a))
    )
      return true;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const t = segs[j];
      if (boxesOverlap(s, t) && segmentsIntersect(s.a, s.b, t.a, t.b))
        return true;
    }
  }
  return false;
}

/** Two rings cross or touch anywhere. */
export function ringsIntersect(a: Ring, b: Ring): boolean {
  const sa = segments(a);
  const sb = segments(b);
  for (const s of sa)
    for (const t of sb)
      if (boxesOverlap(s, t) && segmentsIntersect(s.a, s.b, t.a, t.b))
        return true;
  return false;
}

/** [[south, west], [north, east]] of every ring. */
export function ringsBbox(rings: Ring[]): [LatLng, LatLng] {
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  for (const ring of rings)
    for (const [lat, lng] of ring) {
      s = Math.min(s, lat);
      n = Math.max(n, lat);
      w = Math.min(w, lng);
      e = Math.max(e, lng);
    }
  return [
    [s, w],
    [n, e],
  ];
}
