/**
 * Builds the region catalog of the venue delivery area: src/modules/delivery/regions/uz-regions.json.
 * Source, parameters and how to rerun: README.md next to this file. Not part of the build.
 *
 *   npx ts-node --transpile-only scripts/delivery-regions/build.ts [--refresh]
 *
 * --refresh downloads the OSM relations again (otherwise the files in .cache/ are reused).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import polygonClipping, { MultiPolygon } from 'polygon-clipping';
import {
  LatLng,
  Ring,
  ringsBbox,
  ringsIntersect,
  roundRing,
  selfIntersects,
} from '../../src/modules/delivery/domain/geometry';

/** ISO 3166-2:UZ code → OSM relation and names (uz in Latin script). */
const REGIONS: {
  code: string;
  relation: number;
  name: { uz: string; ru: string; en: string };
}[] = [
  {
    code: 'UZ-AN',
    relation: 178016,
    name: {
      uz: 'Andijon viloyati',
      ru: 'Андижанская область',
      en: 'Andijan Region',
    },
  },
  {
    code: 'UZ-BU',
    relation: 1670973,
    name: {
      uz: 'Buxoro viloyati',
      ru: 'Бухарская область',
      en: 'Bukhara Region',
    },
  },
  {
    code: 'UZ-FA',
    relation: 178018,
    name: {
      uz: 'Fargʻona viloyati',
      ru: 'Ферганская область',
      en: 'Fergana Region',
    },
  },
  {
    code: 'UZ-JI',
    relation: 196254,
    name: {
      uz: 'Jizzax viloyati',
      ru: 'Джизакская область',
      en: 'Jizzakh Region',
    },
  },
  {
    code: 'UZ-NG',
    relation: 178017,
    name: {
      uz: 'Namangan viloyati',
      ru: 'Наманганская область',
      en: 'Namangan Region',
    },
  },
  {
    code: 'UZ-NW',
    relation: 196246,
    name: {
      uz: 'Navoiy viloyati',
      ru: 'Навоийская область',
      en: 'Navoiy Region',
    },
  },
  {
    code: 'UZ-QA',
    relation: 1670974,
    name: {
      uz: 'Qashqadaryo viloyati',
      ru: 'Кашкадарьинская область',
      en: 'Kashkadarya Region',
    },
  },
  {
    code: 'UZ-QR',
    relation: 196241,
    name: {
      uz: 'Qoraqalpogʻiston Respublikasi',
      ru: 'Республика Каракалпакстан',
      en: 'Republic of Karakalpakstan',
    },
  },
  {
    code: 'UZ-SA',
    relation: 196249,
    name: {
      uz: 'Samarqand viloyati',
      ru: 'Самаркандская область',
      en: 'Samarkand Region',
    },
  },
  {
    code: 'UZ-SI',
    relation: 196253,
    name: {
      uz: 'Sirdaryo viloyati',
      ru: 'Сырдарьинская область',
      en: 'Syrdarya Region',
    },
  },
  {
    code: 'UZ-SU',
    relation: 196248,
    name: {
      uz: 'Surxondaryo viloyati',
      ru: 'Сурхандарьинская область',
      en: 'Surkhandarya Region',
    },
  },
  {
    code: 'UZ-TK',
    relation: 2216724,
    name: { uz: 'Toshkent shahri', ru: 'Ташкент', en: 'Tashkent City' },
  },
  {
    code: 'UZ-TO',
    relation: 196251,
    name: {
      uz: 'Toshkent viloyati',
      ru: 'Ташкентская область',
      en: 'Tashkent Region',
    },
  },
  {
    code: 'UZ-XO',
    relation: 196242,
    name: {
      uz: 'Xorazm viloyati',
      ru: 'Хорезмская область',
      en: 'Khorezm Region',
    },
  },
];

/** Simplification tolerance in metres: the city is drawn closer than the regions. */
const TOLERANCE_M: Record<string, number> = { 'UZ-TK': 30 };
const DEFAULT_TOLERANCE_M = 150;
/** Pieces left over from the city cut that are smaller than this are noise, not land. */
const MIN_RING_AREA_M2 = 10_000;
const DIGITS = 6;

const ATTRIBUTION = '© OpenStreetMap contributors';
const LICENSE = 'ODbL-1.0';

const HERE = __dirname;
const CACHE = join(HERE, '.cache');
const OUT = join(HERE, '../../src/modules/delivery/regions/uz-regions.json');
const UA = 'xmenu-delivery-regions/1.0 (build script)';

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** The relation assembled into polygons (polygons.openstreetmap.fr, params=0: not simplified). */
async function relationGeometry(
  relation: number,
  refresh: boolean,
): Promise<MultiPolygon> {
  const file = join(CACHE, `${relation}.geojson`);
  if (refresh || !existsSync(file)) {
    const text = await fetchText(
      `https://polygons.openstreetmap.fr/get_geojson.py?id=${relation}&params=0`,
    );
    writeFileSync(file, text);
  }
  return multiPolygonOf(JSON.parse(readFileSync(file, 'utf8')) as GeoJson);
}

type GeoJson = { type: string; coordinates?: unknown; geometries?: GeoJson[] };

function multiPolygonOf(g: GeoJson): MultiPolygon {
  if (g.type === 'GeometryCollection')
    return (g.geometries ?? []).flatMap(multiPolygonOf);
  if (g.type === 'MultiPolygon') return g.coordinates as MultiPolygon;
  if (g.type === 'Polygon') return [g.coordinates as MultiPolygon[number]];
  return [];
}

/** Version and edit time of every relation (OSM API), written into the catalog as its source. */
async function relationMeta(
  relations: number[],
): Promise<Map<number, { version: number; timestamp: string }>> {
  const body = JSON.parse(
    await fetchText(
      `https://api.openstreetmap.org/api/0.6/relations.json?relations=${relations.join(',')}`,
    ),
  ) as { elements: { id: number; version: number; timestamp: string }[] };
  return new Map(
    body.elements.map((e) => [
      e.id,
      { version: e.version, timestamp: e.timestamp },
    ]),
  );
}

/** Local plane in metres around a latitude (equirectangular): good enough inside one region. */
const metresPerDegLat = 110_574;
const metresPerDegLng = (lat: number) =>
  111_320 * Math.cos((lat * Math.PI) / 180);

/** Distance in metres from p to segment a–b on the local plane. */
function segmentDistanceM(p: LatLng, a: LatLng, b: LatLng, kx: number) {
  const ax = a[1] * kx;
  const ay = a[0] * metresPerDegLat;
  const bx = b[1] * kx - ax;
  const by = b[0] * metresPerDegLat - ay;
  const px = p[1] * kx - ax;
  const py = p[0] * metresPerDegLat - ay;
  const len = bx * bx + by * by;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Douglas–Peucker of an open ring: every dropped point is within tolerance of the kept outline. */
function simplifyRing(ring: Ring, toleranceM: number): Ring {
  if (toleranceM <= 0 || ring.length <= 4) return ring;
  const kx = metresPerDegLng(ring[0][0]);
  // Split at the first point and the farthest from it, so the closed outline is two open chains
  let far = 0;
  let farD = -1;
  ring.forEach((p, i) => {
    const d = Math.hypot(
      (p[1] - ring[0][1]) * kx,
      (p[0] - ring[0][0]) * metresPerDegLat,
    );
    if (d > farD) {
      farD = d;
      far = i;
    }
  });
  const keep = new Array<boolean>(ring.length + 1).fill(false);
  const pts = [...ring, ring[0]];
  keep[0] = keep[far] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [
    [0, far],
    [far, pts.length - 1],
  ];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    let index = -1;
    let max = toleranceM;
    for (let i = from + 1; i < to; i++) {
      const d = segmentDistanceM(pts[i], pts[from], pts[to], kx);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (index >= 0) {
      keep[index] = true;
      stack.push([from, index], [index, to]);
    }
  }
  const out = pts.slice(0, -1).filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

/** Shoelace area in m². */
function ringAreaM2(ring: Ring): number {
  const kx = metresPerDegLng(ring[0][0]);
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    sum +=
      ring[j][1] * kx * ring[i][0] * metresPerDegLat -
      ring[i][1] * kx * ring[j][0] * metresPerDegLat;
  return Math.abs(sum / 2);
}

/** GeoJSON rings ([lng, lat], closed) → open [lat, lng] rings; tiny pieces dropped. */
function toRings(mp: MultiPolygon, code: string): Ring[] {
  const rings: Ring[] = [];
  for (const polygon of mp)
    for (const closed of polygon) {
      const ring: Ring = closed.map(([lng, lat]) => [lat, lng]);
      const [first, last] = [ring[0], ring[ring.length - 1]];
      if (first[0] === last[0] && first[1] === last[1]) ring.pop();
      const area = ringAreaM2(ring);
      if (ring.length < 3 || area < MIN_RING_AREA_M2) {
        console.warn(`${code}: dropped a ring of ${Math.round(area)} m²`);
        continue;
      }
      rings.push(ring);
    }
  return rings;
}

/**
 * Simplifies every ring, then checks the result: no ring crosses itself or another ring of the region (after
 * rounding). A ring that fails is simplified again with half the tolerance; below 1 m the source itself is broken.
 */
function simplifyRegion(code: string, rings: Ring[], toleranceM: number) {
  const tolerance = rings.map(() => toleranceM);
  for (;;) {
    const out = rings.map((r, i) =>
      roundRing(simplifyRing(r, tolerance[i]), DIGITS),
    );
    const bad = new Set<number>();
    out.forEach((r, i) => {
      if (selfIntersects(r)) bad.add(i);
      for (let j = i + 1; j < out.length; j++)
        if (ringsIntersect(r, out[j])) bad.add(i).add(j);
    });
    if (bad.size === 0) return { rings: out, tolerance };
    for (const i of bad) {
      if (tolerance[i] < 1)
        throw new Error(`${code}: ring ${i} is invalid even unsimplified`);
      tolerance[i] = tolerance[i] < 2 ? 0 : tolerance[i] / 2;
    }
  }
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  mkdirSync(CACHE, { recursive: true });
  const meta = await relationMeta(REGIONS.map((r) => r.relation));
  const raw = new Map<string, MultiPolygon>();
  for (const r of REGIONS)
    raw.set(r.code, await relationGeometry(r.relation, refresh));
  // OSM draws Tashkent Region over the city: cut the city out (a hole)
  raw.set(
    'UZ-TO',
    polygonClipping.difference(raw.get('UZ-TO')!, raw.get('UZ-TK')!),
  );

  const regions: {
    code: string;
    name: { uz: string; ru: string; en: string };
    bbox: [LatLng, LatLng];
    rings: Ring[];
  }[] = [];
  const report: string[] = [];
  for (const r of REGIONS) {
    const rings = toRings(raw.get(r.code)!, r.code);
    const before = rings.reduce((n, ring) => n + ring.length, 0);
    const toleranceM = TOLERANCE_M[r.code] ?? DEFAULT_TOLERANCE_M;
    const simplified = simplifyRegion(r.code, rings, toleranceM);
    const after = simplified.rings.reduce((n, ring) => n + ring.length, 0);
    const tightened = simplified.tolerance.filter((t) => t < toleranceM).length;
    report.push(
      `${r.code}  rings ${rings.length}  points ${before} → ${after}  tolerance ${toleranceM} m` +
        (tightened ? `  (${tightened} ring(s) tightened)` : ''),
    );
    regions.push({
      code: r.code,
      name: r.name,
      bbox: ringsBbox(simplified.rings),
      rings: simplified.rings,
    });
  }

  const latest = [...meta.values()]
    .map((m) => m.timestamp)
    .sort()
    .pop();
  const catalog = {
    version: `osm-${new Date().toISOString().slice(0, 10)}`,
    license: LICENSE,
    attribution: ATTRIBUTION,
    source: REGIONS.map((r) => ({
      code: r.code,
      relation: r.relation,
      osmVersion: meta.get(r.relation)?.version ?? null,
      timestamp: meta.get(r.relation)?.timestamp ?? null,
    })),
    regions,
  };
  const json = JSON.stringify(catalog);
  writeFileSync(OUT, json + '\n');
  console.log(report.join('\n'));
  console.log(
    `latest relation edit ${latest}; ${OUT}: ${(json.length / 1024).toFixed(0)} KB`,
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
