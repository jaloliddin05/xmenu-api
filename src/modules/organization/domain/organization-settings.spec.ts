import { Prisma } from '@prisma/client';
import {
  OrganizationSettings,
  parseBounds,
  parseTheme,
  settingsProblems,
  toSettingsData,
  toSettingsView,
} from './organization-settings';

const VALID: OrganizationSettings = {
  theme: { brand: '#EE2E17', muted: '#4B494380' },
  currency: 'UZS',
  defaultLanguage: 'uz',
  languages: ['uz', 'ru'],
  supportPhone: '+998711234567',
  supportTelegram: '@demo_cafe',
  supportHours: ' 10:00-23:00 ',
  address: 'Main street 1',
  foundedYear: 2015,
  city: 'Tashkent',
  mapCenter: { lat: 41.31, lng: 69.24 },
  mapZoom: 15,
  mapBounds: [
    [41.15, 69.0],
    [41.45, 69.45],
  ],
};
const NOW = new Date('2026-10-29T00:00:00Z');

describe('settingsProblems', () => {
  it('accepts consistent settings', () => {
    expect(settingsProblems(VALID, NOW)).toEqual([]);
  });

  it('requires the default language among the languages', () => {
    expect(settingsProblems({ ...VALID, defaultLanguage: 'en' }, NOW)).toEqual([
      {
        field: 'defaultLanguage',
        reason: 'notInLanguages',
        message: 'defaultLanguage must be one of languages',
      },
    ]);
  });

  it('refuses a founding year in the future', () => {
    expect(settingsProblems({ ...VALID, foundedYear: 2027 }, NOW)).toEqual([
      expect.objectContaining({ field: 'foundedYear', reason: 'inFuture' }),
    ]);
    expect(settingsProblems({ ...VALID, foundedYear: 2026 }, NOW)).toEqual([]);
  });

  it.each([
    ['one point', [[41.1, 69.0]]],
    [
      'south-west above north-east',
      [
        [41.5, 69.0],
        [41.4, 69.45],
      ],
    ],
    [
      'west right of east',
      [
        [41.1, 69.5],
        [41.4, 69.45],
      ],
    ],
    [
      'latitude out of range',
      [
        [-91, 69.0],
        [41.4, 69.45],
      ],
    ],
    [
      'longitude out of range',
      [
        [41.1, 69.0],
        [41.4, 181],
      ],
    ],
    [
      'not numbers',
      [
        ['41.1', 69.0],
        [41.4, 69.45],
      ],
    ],
    [
      'three coordinates',
      [
        [41.1, 69.0, 1],
        [41.4, 69.45],
      ],
    ],
  ])('refuses bounds: %s', (_name, bounds) => {
    const problems = settingsProblems(
      { ...VALID, mapCenter: null, mapBounds: bounds as any },
      NOW,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ field: 'mapBounds', reason: 'invalidBounds' });
  });

  it('requires the map center inside the bounds when both are set', () => {
    expect(
      settingsProblems({ ...VALID, mapCenter: { lat: 40, lng: 69.24 } }, NOW),
    ).toEqual([
      expect.objectContaining({ field: 'mapCenter', reason: 'outsideBounds' }),
    ]);
    expect(
      settingsProblems(
        { ...VALID, mapCenter: { lat: 40, lng: 69.24 }, mapBounds: null },
        NOW,
      ),
    ).toEqual([]);
  });
});

describe('parseTheme / parseBounds', () => {
  it('keeps only known keys with valid colors', () => {
    expect(parseTheme({ brand: '#fff', danger: 'red', extra: '#000' })).toEqual(
      {
        brand: '#fff',
      },
    );
    expect(parseTheme({})).toBeNull();
    expect(parseTheme([])).toBeNull();
    expect(parseTheme(null)).toBeNull();
  });

  it('returns typed bounds or null', () => {
    expect(parseBounds(VALID.mapBounds)).toEqual(VALID.mapBounds);
    expect(parseBounds(null)).toBeNull();
  });
});

describe('toSettingsData / toSettingsView', () => {
  it('normalises what is stored and reads it back', () => {
    const data = toSettingsData(VALID);
    expect(data).toMatchObject({
      default_language: 'uz',
      languages: ['uz', 'ru'],
      support_telegram: 'demo_cafe',
      support_hours: '10:00-23:00',
      map_center_lat: 41.31,
      map_center_lng: 69.24,
    });
    const row = {
      organization_id: 'org',
      created_at: NOW,
      updated_at: NOW,
      ...data,
    } as any;
    expect(toSettingsView(row)).toEqual({
      ...VALID,
      supportTelegram: 'demo_cafe',
      supportHours: '10:00-23:00',
    });
  });

  it('clears JSON columns with a database NULL', () => {
    const data = toSettingsData({ ...VALID, theme: null, mapBounds: null });
    expect(data.theme).toBe(Prisma.DbNull);
    expect(data.map_bounds).toBe(Prisma.DbNull);
  });

  it('reads an empty row as nulls', () => {
    const row = {
      organization_id: 'org',
      theme: null,
      currency: 'UZS',
      default_language: 'ru',
      languages: ['ru', 'uz', 'en'],
      support_phone: null,
      support_telegram: null,
      support_hours: null,
      address: null,
      founded_year: null,
      city: null,
      map_center_lat: null,
      map_center_lng: null,
      map_zoom: null,
      map_bounds: null,
      created_at: NOW,
      updated_at: NOW,
    };
    expect(toSettingsView(row)).toEqual({
      theme: null,
      currency: 'UZS',
      defaultLanguage: 'ru',
      languages: ['ru', 'uz', 'en'],
      supportPhone: null,
      supportTelegram: null,
      supportHours: null,
      address: null,
      foundedYear: null,
      city: null,
      mapCenter: null,
      mapZoom: null,
      mapBounds: null,
    });
  });
});
