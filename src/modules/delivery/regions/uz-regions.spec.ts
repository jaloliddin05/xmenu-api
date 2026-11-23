import { COUNTRY_BOUNDS } from '../domain/delivery-area';
import {
  LatLng,
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

describe('region catalog (uz-regions.json)', () => {
  it('has the 14 regions of ISO 3166-2:UZ, with names, version and attribution', () => {
    expect(catalog.list().map((r) => r.code)).toEqual(ISO_CODES);
    for (const r of catalog.list()) {
      expect(r.name.uz).toEqual(expect.any(String));
      expect(r.name.ru).toEqual(expect.any(String));
      expect(r.name.en).toEqual(expect.any(String));
    }
    expect(catalog.version).toMatch(/^osm-\d{4}-\d{2}-\d{2}$/);
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

  it('Nukus is in Karakalpakstan, Samarkand in its region', () => {
    expect(regionsAt([42.46, 59.61])).toEqual(['UZ-QR']);
    expect(regionsAt([39.6542, 66.9597])).toEqual(['UZ-SA']);
  });
});
