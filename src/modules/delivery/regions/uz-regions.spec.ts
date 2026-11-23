import { readFileSync } from 'fs';
import { join } from 'path';
import { COUNTRY_BOUNDS } from '../domain/delivery-area';
import {
  LatLng,
  Ring,
  pointInRings,
  ringsIntersect,
  selfIntersects,
} from '../domain/geometry';
import { RegionCatalog } from './region-catalog';

/** The committed catalog (uz-regions.json, scripts/delivery-regions/build.ts). */
const catalog = new RegionCatalog();
const ISO_CODES = [
  'UZ-AN',
  'UZ-BU',
  'UZ-FA',
  'UZ-JI',
  'UZ-NG',
  'UZ-NW',
  'UZ-QA',
  'UZ-QR',
  'UZ-SA',
  'UZ-SI',
  'UZ-SU',
  'UZ-TK',
  'UZ-TO',
  'UZ-XO',
];

const regionsAt = ([lat, lng]: LatLng) =>
  catalog
    .list()
    .filter((r) => pointInRings(lat, lng, r.rings))
    .map((r) => r.code);

/** The unsimplified OSM border of the city, written by the build script next to the catalog. */
const cityBorder = (
  JSON.parse(
    readFileSync(join(__dirname, 'fixtures/uz-tk-osm-border.json'), 'utf8'),
  ) as { rings: Ring[] }
).rings;

/** Local plane in metres around a point (equirectangular), as in the build script. */
const M_PER_DEG_LAT = 110_574;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Points every `stepM` along the edges of a ring, with the unit normal of their edge (in metres). */
function alongRing(ring: Ring, stepM: number) {
  const out: { p: LatLng; nx: number; ny: number }[] = [];
  let carry = 0;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const kx = mPerDegLng(a[0]);
    const dx = (b[1] - a[1]) * kx;
    const dy = (b[0] - a[0]) * M_PER_DEG_LAT;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    for (let d = carry; d < len; d += stepM) {
      const t = d / len;
      out.push({
        p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        nx: -dy / len,
        ny: dx / len,
      });
    }
    carry = (carry - len) % stepM;
    if (carry < 0) carry += stepM;
  });
  return out;
}

const offset = ([lat, lng]: LatLng, nx: number, ny: number, m: number) =>
  [lat + (ny * m) / M_PER_DEG_LAT, lng + (nx * m) / mPerDegLng(lat)] as LatLng;

/** A ring as a comparable key: from its smallest point, in the smaller of the two directions. */
function ringKey(ring: Ring): string {
  const fromSmallest = (r: Ring) => {
    let k = 0;
    r.forEach((p, i) => {
      if (p[0] < r[k][0] || (p[0] === r[k][0] && p[1] < r[k][1])) k = i;
    });
    return JSON.stringify([...r.slice(k), ...r.slice(0, k)]);
  };
  const a = fromSmallest(ring);
  const b = fromSmallest([...ring].reverse());
  return a < b ? a : b;
}

const cityOrRegion = (p: LatLng) =>
  regionsAt(p).filter((c) => c === 'UZ-TK' || c === 'UZ-TO');

describe('region catalog (uz-regions.json)', () => {
  it('has the 14 regions of ISO 3166-2:UZ, with names, version and attribution', () => {
    expect(catalog.list().map((r) => r.code)).toEqual(ISO_CODES);
    for (const r of catalog.list()) {
      expect(r.name.uz).toEqual(expect.any(String));
      expect(r.name.ru).toEqual(expect.any(String));
      expect(r.name.en).toEqual(expect.any(String));
    }
    expect(catalog.version).toMatch(/^osm-\d{4}-\d{2}-\d{2}(\.\d+)?$/);
    expect(catalog.attribution).toContain('OpenStreetMap');
    expect(catalog.license).toBe('ODbL-1.0');
  });

  it.each(ISO_CODES)(
    '%s is valid: open rings without crossings, inside the country',
    (code) => {
      const { rings, bbox } = catalog.find(code)!;
      expect(rings.length).toBeGreaterThan(0);
      for (const [i, ring] of rings.entries()) {
        expect(ring.length).toBeGreaterThanOrEqual(4);
        expect(ring[0]).not.toEqual(ring[ring.length - 1]);
        expect(selfIntersects(ring)).toBe(false);
        for (const other of rings.slice(i + 1))
          expect(ringsIntersect(ring, other)).toBe(false);
        for (const [lat, lng] of ring) {
          expect(lat).toBeGreaterThanOrEqual(COUNTRY_BOUNDS.minLat);
          expect(lat).toBeLessThanOrEqual(COUNTRY_BOUNDS.maxLat);
          expect(lng).toBeGreaterThanOrEqual(COUNTRY_BOUNDS.minLng);
          expect(lng).toBeLessThanOrEqual(COUNTRY_BOUNDS.maxLng);
        }
      }
      const [[s, w], [n, e]] = bbox;
      expect(s).toBeLessThan(n);
      expect(w).toBeLessThan(e);
    },
  );

  it('the centre of Tashkent is in the city, not in Tashkent Region', () => {
    expect(regionsAt([41.3111, 69.2797])).toEqual(['UZ-TK']);
  });

  it('Tashkent Region outside the city: Chirchiq and Angren', () => {
    expect(regionsAt([41.469, 69.582])).toEqual(['UZ-TO']);
    expect(regionsAt([41.017, 70.143])).toEqual(['UZ-TO']);
  });

  it('the Fergana exclaves Sokh and Shohimardon belong to Fergana Region', () => {
    expect(regionsAt([39.96, 71.13])).toEqual(['UZ-FA']);
    expect(regionsAt([39.985, 71.8])).toEqual(['UZ-FA']);
  });

  describe('the shared border of the city and Tashkent Region', () => {
    it('the city rings are exactly the holes of the region', () => {
      const holes = new Set(catalog.find('UZ-TO')!.rings.map(ringKey));
      for (const ring of catalog.find('UZ-TK')!.rings)
        expect(holes.has(ringKey(ring))).toBe(true);
    });

    it('a point 20 m to either side of the OSM border is in exactly one of them', () => {
      for (const ring of cityBorder)
        ring.forEach((a, i) => {
          const b = ring[(i + 1) % ring.length];
          const kx = mPerDegLng(a[0]);
          const dx = (b[1] - a[1]) * kx;
          const dy = (b[0] - a[0]) * M_PER_DEG_LAT;
          const len = Math.hypot(dx, dy);
          if (len === 0) return;
          const mid: LatLng = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          for (const side of [20, -20])
            expect([
              mid,
              cityOrRegion(offset(mid, -dy / len, dx / len, side)),
            ]).toEqual([mid, [expect.any(String)]]);
        });
    });

    it('no gap along the border: every point ~200 m apart is in exactly one of them', () => {
      const points = cityBorder.flatMap((ring) => alongRing(ring, 200));
      expect(points.length).toBeGreaterThan(100);
      for (const { p } of points)
        expect([p, cityOrRegion(p)]).toEqual([p, [expect.any(String)]]);
    });
  });

  it('Nukus is in Karakalpakstan, Samarkand in its region', () => {
    expect(regionsAt([42.46, 59.61])).toEqual(['UZ-QR']);
    expect(regionsAt([39.6542, 66.9597])).toEqual(['UZ-SA']);
  });
});
