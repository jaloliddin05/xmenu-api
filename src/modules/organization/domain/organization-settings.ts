import { Prisma } from '@prisma/client';
import type { organization_settings } from '@prisma/client';
import { isLang, Lang } from 'src/infra/http/request-helpers';
import type { FieldError } from 'src/infra/validators/validation-errors';

/** Brand colors a front-end can override; any key may be missing (the front-end keeps its neutral value). */
export const THEME_KEYS = [
  'background',
  'foreground',
  'surface',
  'mutedSurface',
  'muted',
  'brand',
  'brandForeground',
  'danger',
  'serviceArea',
] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];
export type Theme = Partial<Record<ThemeKey, string>>;

/** #RGB, #RRGGBB or #RRGGBBAA. */
export const HEX_COLOR_RE =
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Prices are integer sums (order-money.ts), so only currencies without minor units fit for now. */
export const SUPPORTED_CURRENCIES = ['UZS'] as const;

export const FOUNDED_YEAR_MIN = 1800;
export const MAP_ZOOM_MAX = 21;

export type LatLng = [number, number];
/** [[southWestLat, southWestLng], [northEastLat, northEastLng]] */
export type Bounds = [LatLng, LatLng];

/** Settings as the owner reads and writes them (GET and PUT /organization/:id/settings). */
export interface OrganizationSettings {
  theme: Theme | null;
  currency: string;
  defaultLanguage: Lang;
  languages: Lang[];
  supportPhone: string | null;
  supportTelegram: string | null;
  supportHours: string | null;
  address: string | null;
  foundedYear: number | null;
  city: string | null;
  mapCenter: { lat: number; lng: number } | null;
  mapZoom: number | null;
  mapBounds: Bounds | null;
}

const isLat = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
const isLng = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;

/** Valid [[swLat, swLng], [neLat, neLng]] with south-west strictly below and left of north-east, or null. */
export function parseBounds(value: unknown): Bounds | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [sw, ne] = value as unknown[];
  const point = (p: unknown): LatLng | null =>
    Array.isArray(p) && p.length === 2 && isLat(p[0]) && isLng(p[1])
      ? [p[0], p[1]]
      : null;
  const a = point(sw);
  const b = point(ne);
  if (!a || !b || a[0] >= b[0] || a[1] >= b[1]) return null;
  return [a, b];
}

/** Theme stored as JSON: only known keys with valid colors survive. */
export function parseTheme(value: unknown): Theme | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const theme: Theme = {};
  for (const key of THEME_KEYS) {
    const color = (value as Record<string, unknown>)[key];
    if (typeof color === 'string' && HEX_COLOR_RE.test(color))
      theme[key] = color;
  }
  return Object.keys(theme).length ? theme : null;
}

/**
 * Rules spanning several fields, checked after the DTO validated each field on its own.
 * Returns the problems (empty when the settings are consistent).
 */
export function settingsProblems(
  s: OrganizationSettings,
  now = new Date(),
): FieldError[] {
  const problems: FieldError[] = [];
  if (!s.languages.includes(s.defaultLanguage)) {
    problems.push({
      field: 'defaultLanguage',
      reason: 'notInLanguages',
      message: 'defaultLanguage must be one of languages',
    });
  }
  if (s.foundedYear !== null && s.foundedYear > now.getFullYear()) {
    problems.push({
      field: 'foundedYear',
      reason: 'inFuture',
      message: 'foundedYear must not be in the future',
    });
  }
  if (s.mapBounds !== null && parseBounds(s.mapBounds) === null) {
    problems.push({
      field: 'mapBounds',
      reason: 'invalidBounds',
      message:
        'mapBounds must be [[southWestLat, southWestLng], [northEastLat, northEastLng]] with valid coordinates, south-west below and left of north-east',
    });
  }
  const bounds = s.mapBounds && parseBounds(s.mapBounds);
  if (s.mapCenter && bounds) {
    const { lat, lng } = s.mapCenter;
    const [[s0, w0], [n0, e0]] = bounds;
    if (lat < s0 || lat > n0 || lng < w0 || lng > e0) {
      problems.push({
        field: 'mapCenter',
        reason: 'outsideBounds',
        message: 'mapCenter must lie within mapBounds',
      });
    }
  }
  return problems;
}

/** Database row → the owner's view. */
export function toSettingsView(
  row: organization_settings,
): OrganizationSettings {
  return {
    theme: parseTheme(row.theme),
    currency: row.currency,
    defaultLanguage: row.default_language as Lang,
    languages: row.languages.filter(isLang),
    supportPhone: row.support_phone,
    supportTelegram: row.support_telegram,
    supportHours: row.support_hours,
    address: row.address,
    foundedYear: row.founded_year,
    city: row.city,
    mapCenter:
      row.map_center_lat !== null && row.map_center_lng !== null
        ? { lat: row.map_center_lat, lng: row.map_center_lng }
        : null,
    mapZoom: row.map_zoom,
    mapBounds: parseBounds(row.map_bounds),
  };
}

const blank = (v: string | null) =>
  v === null || v.trim() === '' ? null : v.trim();

/** Validated settings → columns for a full replacement of the row. */
export function toSettingsData(
  s: OrganizationSettings,
): Prisma.organization_settingsUpdateInput {
  const theme = parseTheme(s.theme);
  const bounds = s.mapBounds && parseBounds(s.mapBounds);
  return {
    theme: theme ?? Prisma.DbNull,
    currency: s.currency,
    default_language: s.defaultLanguage,
    languages: [...new Set(s.languages)],
    support_phone: s.supportPhone,
    support_telegram: s.supportTelegram?.replace(/^@/, '') ?? null,
    support_hours: blank(s.supportHours),
    address: blank(s.address),
    founded_year: s.foundedYear,
    city: blank(s.city),
    map_center_lat: s.mapCenter?.lat ?? null,
    map_center_lng: s.mapCenter?.lng ?? null,
    map_zoom: s.mapZoom,
    map_bounds: bounds ?? Prisma.DbNull,
  };
}
