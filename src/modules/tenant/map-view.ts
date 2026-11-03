import type { LatLng } from 'src/modules/organization/domain/organization-settings';

export const MAP_CENTER_SOURCES = ['saved', 'zone', 'branches'] as const;
export type MapCenterSource = (typeof MAP_CENTER_SOURCES)[number];

export interface MapView {
  center: LatLng | null;
  centerSource: MapCenterSource | null;
  zoom: number | null;
}

const ZOOM_MIN = 10;
const ZOOM_MAX = 17;
/** One point (a single branch): street level. */
const ZOOM_POINT = 16;

type Point = [number, number];

const boxOf = (points: Point[]) => {
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  const [south, north] = [Math.min(...lats), Math.max(...lats)];
  const [west, east] = [Math.min(...lngs), Math.max(...lngs)];
  return { south, north, west, east };
};

/** Center of the bounding box and a zoom at which the box takes 256-512 px of the screen. */
function fit(points: Point[]): { center: Point; zoom: number } {
  const { south, north, west, east } = boxOf(points);
  const center: Point = [(south + north) / 2, (west + east) / 2];
  // A degree of latitude is about two degrees of longitude on screen at these latitudes
  const span = Math.max(east - west, (north - south) * 2);
  if (span <= 0) return { center, zoom: ZOOM_POINT };
  const zoom = Math.floor(Math.log2(360 / span)) + 1;
  return { center, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) };
}

/**
 * The map view the front-end opens on. The owner's saved view wins; without one the center comes
 * from the delivery zone, then from the branch coordinates, so a venue with a zone or a branch never
 * gets an empty map. A saved zoom is kept in every case.
 */
export function resolveMapView(
  saved: { center: { lat: number; lng: number } | null; zoom: number | null },
  zone: LatLng[] | null,
  branchPoints: Point[],
): MapView {
  if (saved.center) {
    return {
      center: [saved.center.lat, saved.center.lng],
      centerSource: 'saved',
      zoom: saved.zoom,
    };
  }
  const zonePoints = zone ?? [];
  const [source, points]: [MapCenterSource, Point[]] = zonePoints.length
    ? ['zone', zonePoints]
    : ['branches', branchPoints];
  if (!points.length)
    return { center: null, centerSource: null, zoom: saved.zoom };
  const view = fit(points);
  return {
    center: view.center,
    centerSource: source,
    zoom: saved.zoom ?? view.zoom,
  };
}
