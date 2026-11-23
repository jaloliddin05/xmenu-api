/**
 * Builds the region catalog of the venue delivery area: src/modules/delivery/regions/uz-regions.json.
 * Source, parameters and how to rerun: README.md next to this file. Not part of the build.
 *
 *   npx ts-node --transpile-only scripts/delivery-regions/build.ts [--refresh]
 *
 * --refresh downloads the OSM relations again (otherwise the files in .cache/ are reused).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import {
  LatLng,
  Ring,
  pointInRing,
  ringsBbox,
  ringsIntersect,
  roundRing,
  selfIntersects,
} from '../../src/modules/delivery/domain/geometry';

// mapshaper ships no types: only applyCommands is used
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mapshaper = require('mapshaper') as {
  applyCommands(
    cmd: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, string | Buffer>>;
};

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

/**
 * Simplification tolerance in metres: the city is drawn closer than the regions. A border shared by two regions is
 * one arc of the topology and gets the smaller tolerance of the two (the city/region border: the city's 30 m).
 */
const TOLERANCE_M: Record<string, number> = { 'UZ-TK': 30 };
const DEFAULT_TOLERANCE_M = 150;
/** mapshaper measures on the sphere, the check below on a local plane: a metre of slack covers the difference. */
const CHECK_SLACK_M = 1;
/** Rings of the source smaller than this are noise, not land. */
const MIN_RING_AREA_M2 = 10_000;
const DIGITS = 6;
const CITY = 'UZ-TK';
const CITY_REGION = 'UZ-TO';

const ATTRIBUTION = '© OpenStreetMap contributors';
const LICENSE = 'ODbL-1.0';

const HERE = __dirname;
const CACHE = join(HERE, '.cache');
const OUT = join(HERE, '../../src/modules/delivery/regions/uz-regions.json');
/** The unsimplified city border, for the tests of the shared city/region border (not shipped with the build). */
const BORDER_FIXTURE = join(
  HERE,
  '../../src/modules/delivery/regions/fixtures/uz-tk-osm-border.json',
);
const UA = 'xmenu-delivery-regions/1.0 (build script)';

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

type Position = [number, number];
type Polygon = Position[][];
type GeoJson = { type: string; coordinates?: unknown; geometries?: GeoJson[] };

/** The relation assembled into polygons (polygons.openstreetmap.fr, params=0: not simplified). */
async function relationGeometry(
  relation: number,
  refresh: boolean,
): Promise<Polygon[]> {
  const file = join(CACHE, `${relation}.geojson`);
  if (refresh || !existsSync(file)) {
    const text = await fetchText(
      `https://polygons.openstreetmap.fr/get_geojson.py?id=${relation}&params=0`,
    );
    writeFileSync(file, text);
  }
  return polygonsOf(JSON.parse(readFileSync(file, 'utf8')) as GeoJson);
}

function polygonsOf(g: GeoJson): Polygon[] {
  if (g.type === 'GeometryCollection')
    return (g.geometries ?? []).flatMap(polygonsOf);
  if (g.type === 'MultiPolygon') return g.coordinates as Polygon[];
  if (g.type === 'Polygon') return [g.coordinates as Polygon];
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

/** GeoJSON polygons ([lng, lat], closed) → open [lat, lng] rings (even-odd); tiny pieces dropped. */
function toRings(polygons: Polygon[], code: string): Ring[] {
  const rings: Ring[] = [];
  for (const polygon of polygons)
    for (const closed of polygon) {
      const ring: Ring = closed.map(([lng, lat]) => [lat, lng]);
      const [first, last] = [ring[0], ring[ring.length - 1]];
      if (first[0] === last[0] && first[1] === last[1]) ring.pop();
      const area = ring.length < 3 ? 0 : ringAreaM2(ring);
      if (area < MIN_RING_AREA_M2) {
        console.warn(`${code}: dropped a ring of ${Math.round(area)} m²`);
        continue;
      }
      rings.push(ring);
    }
  return rings;
}

/**
 * OSM draws Tashkent Region over the city. Every city ring must lie strictly inside one ring of the region and cross
 * none: then the city rings themselves are the holes (even-odd), vertex for vertex, and the border is one shared arc.
 */
function cutCity(region: Ring[], city: Ring[]): Ring[] {
  for (const c of city) {
    if (region.some((r) => ringsIntersect(c, r)))
      throw new Error(`${CITY} crosses the outline of ${CITY_REGION}`);
    if (!region.some((r) => pointInRing(c[0][0], c[0][1], r)))
      throw new Error(`${CITY} is not inside ${CITY_REGION}`);
  }
  return [...region, ...city];
}

/** Even-odd rings → GeoJSON polygons: a ring inside an odd number of others is a hole of its nearest container. */
function toGeoJsonPolygons(rings: Ring[]): Polygon[] {
  const close = (r: Ring): Position[] =>
    [...r, r[0]].map(([lat, lng]) => [lng, lat]);
  const containers = rings.map((r, i) =>
    rings
      .map((_, j) => j)
      .filter((j) => j !== i && pointInRing(r[0][0], r[0][1], rings[j])),
  );
  const polygons = new Map<number, Polygon>();
  rings.forEach((r, i) => {
    if (containers[i].length % 2 === 0) polygons.set(i, [close(r)]);
  });
  rings.forEach((r, i) => {
    if (containers[i].length % 2 === 0) return;
    // the nearest container is the one inside the most others
    const parent = containers[i].reduce((a, b) =>
      containers[a].length >= containers[b].length ? a : b,
    );
    polygons.get(parent)!.push(close(r));
  });
  return [...polygons.values()];
}

/**
 * Simplifies all regions as one topology (mapshaper): a border shared by neighbours is a single arc, simplified once,
 * so neighbours keep meeting exactly, without gaps or overlaps. Douglas–Peucker on the sphere; the tolerance of an arc
 * is the smallest of the regions using it (mapshaper `variable`); mapshaper repairs crossings it introduces.
 */
async function simplifyAll(
  raw: Map<string, Ring[]>,
  tolerance: Record<string, number>,
): Promise<Map<string, Ring[]>> {
  const collection = {
    type: 'FeatureCollection',
    features: [...raw].map(([code, rings]) => ({
      type: 'Feature',
      properties: { code },
      geometry: { type: 'MultiPolygon', coordinates: toGeoJsonPolygons(rings) },
    })),
  };
  const interval =
    Object.entries(tolerance)
      .map(([code, m]) => `code=='${code}'?${m}:`)
      .join('') + `${DEFAULT_TOLERANCE_M}`;
  const out = await mapshaper.applyCommands(
    `-i in.json -simplify dp variable interval="${interval}" keep-shapes -o out.json format=geojson`,
    { 'in.json': collection },
  );
  const result = JSON.parse(out['out.json'].toString()) as {
    features: { properties: { code: string }; geometry: GeoJson }[];
  };
  return new Map(
    result.features.map((f) => [
      f.properties.code,
      toRings(polygonsOf(f.geometry), f.properties.code).map((r) =>
        roundRing(r, DIGITS),
      ),
    ]),
  );
}

/** Farthest distance in metres from a source point to the simplified outline of the region. */
function maxDeviationM(source: Ring[], simplified: Ring[]): number {
  let worst = 0;
  for (const ring of source)
    for (const p of ring) {
      const kx = metresPerDegLng(p[0]);
      let best = Infinity;
      for (const r of simplified)
        for (let i = 0; i < r.length && best > worst; i++)
          best = Math.min(
            best,
            segmentDistanceM(p, r[i], r[(i + 1) % r.length], kx),
          );
      worst = Math.max(worst, best);
    }
  return worst;
}

/** A ring as a comparable key: same points from the smallest one, in the smaller of the two directions. */
function ringKey(ring: Ring): string {
  const rotate = (r: Ring) => {
    let k = 0;
    r.forEach((p, i) => {
      const q = r[k];
      if (p[0] < q[0] || (p[0] === q[0] && p[1] < q[1])) k = i;
    });
    return [...r.slice(k), ...r.slice(0, k)];
  };
  const a = JSON.stringify(rotate(ring));
  const b = JSON.stringify(rotate([...ring].reverse()));
  return a < b ? a : b;
}

/** What is wrong with a simplified region; empty when it is fine. */
function problems(
  code: string,
  source: Ring[],
  rings: Ring[],
  toleranceM: number,
): string[] {
  const found: string[] = [];
  if (!rings.length) found.push('no rings left');
  rings.forEach((r, i) => {
    if (r.length < 4) found.push(`ring ${i} has ${r.length} points`);
    if (selfIntersects(r)) found.push(`ring ${i} crosses itself`);
    for (let j = i + 1; j < rings.length; j++)
      if (ringsIntersect(r, rings[j])) found.push(`rings ${i} and ${j} cross`);
  });
  const deviation = maxDeviationM(source, rings);
  if (deviation > toleranceM + CHECK_SLACK_M)
    found.push(`a source point is ${deviation.toFixed(1)} m off`);
  return found.map((p) => `${code}: ${p}`);
}

/** The city rings and the holes of the region are the very same rings: the border has no gap and no overlap. */
function sharedBorderProblems(simplified: Map<string, Ring[]>): string[] {
  const region = new Set(simplified.get(CITY_REGION)!.map(ringKey));
  return simplified
    .get(CITY)!
    .filter((r) => !region.has(ringKey(r)))
    .map(() => `${CITY}: a ring is not a hole of ${CITY_REGION}`);
}

/** `osm-<build date>`; a second build on the same day gets `.2`, `.3`… so saved zones can tell them apart. */
function nextVersion(): string {
  const base = `osm-${new Date().toISOString().slice(0, 10)}`;
  if (!existsSync(OUT)) return base;
  const current = (JSON.parse(readFileSync(OUT, 'utf8')) as { version: string })
    .version;
  if (current !== base && !current.startsWith(`${base}.`)) return base;
  const n = current === base ? 1 : Number(current.slice(base.length + 1));
  return `${base}.${n + 1}`;
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  mkdirSync(CACHE, { recursive: true });
  const meta = await relationMeta(REGIONS.map((r) => r.relation));
  const raw = new Map<string, Ring[]>();
  for (const r of REGIONS)
    raw.set(
      r.code,
      toRings(await relationGeometry(r.relation, refresh), r.code),
    );
  raw.set(CITY_REGION, cutCity(raw.get(CITY_REGION)!, raw.get(CITY)!));

  // A region that fails its checks is simplified again with half the tolerance (its shared arcs too)
  const tolerance: Record<string, number> = { ...TOLERANCE_M };
  const toleranceOf = (code: string) => tolerance[code] ?? DEFAULT_TOLERANCE_M;
  let simplified: Map<string, Ring[]>;
  for (;;) {
    simplified = await simplifyAll(raw, tolerance);
    const border = sharedBorderProblems(simplified);
    if (border.length) throw new Error(border.join('\n'));
    const bad = REGIONS.map((r) => ({
      code: r.code,
      found: problems(
        r.code,
        raw.get(r.code)!,
        simplified.get(r.code) ?? [],
        toleranceOf(r.code),
      ),
    })).filter((r) => r.found.length);
    if (!bad.length) break;
    for (const r of bad) {
      console.warn(r.found.join('\n'));
      if (toleranceOf(r.code) < 1)
        throw new Error(`${r.code} is invalid even unsimplified`);
      tolerance[r.code] = toleranceOf(r.code) / 2;
    }
  }

  const report: string[] = [];
  const regions = REGIONS.map((r) => {
    const rings = simplified.get(r.code)!;
    const before = raw.get(r.code)!.reduce((n, ring) => n + ring.length, 0);
    const after = rings.reduce((n, ring) => n + ring.length, 0);
    report.push(
      `${r.code}  rings ${rings.length}  points ${before} → ${after}  tolerance ${toleranceOf(r.code)} m`,
    );
    return { code: r.code, name: r.name, bbox: ringsBbox(rings), rings };
  });

  const latest = [...meta.values()]
    .map((m) => m.timestamp)
    .sort()
    .pop();
  const city = REGIONS.find((r) => r.code === CITY)!;
  const catalog = {
    version: nextVersion(),
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
  const json = JSON.stringify(catalog) + '\n';
  writeFileSync(OUT, json);
  mkdirSync(dirname(BORDER_FIXTURE), { recursive: true });
  writeFileSync(
    BORDER_FIXTURE,
    JSON.stringify({
      license: LICENSE,
      attribution: ATTRIBUTION,
      code: CITY,
      relation: city.relation,
      osmVersion: meta.get(city.relation)?.version ?? null,
      rings: raw.get(CITY)!.map((r) => roundRing(r, DIGITS)),
    }) + '\n',
  );
  const points = regions.reduce(
    (n, r) => n + r.rings.reduce((m, ring) => m + ring.length, 0),
    0,
  );
  console.log(report.join('\n'));
  console.log(
    `${catalog.version}; latest relation edit ${latest}; ${points} points; ${Buffer.byteLength(json)} bytes`,
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
