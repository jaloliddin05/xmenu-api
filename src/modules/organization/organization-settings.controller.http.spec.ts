import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { createHttpApp, staffToken } from 'src/infra/testing/http-app.fake';
import { PrismaService } from '../_prisma/prisma.service';
import { FileService } from '../file/file.service';
import { RevalidateService } from '../revalidate-queue/revalidate.service';
import { TenantService } from '../tenant/tenant.service';
import { OrganizationSettingsController } from './organization-settings.controller';
import { OrganizationService } from './services/organization.service';
import { OrganizationSettingsService } from './services/organization-settings.service';

const ORG_A = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const ORG_B = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';

const VALID = {
  theme: { brand: '#EE2E17', brandForeground: '#FFF', muted: '#4B494380' },
  currency: 'UZS',
  defaultLanguage: 'uz',
  languages: ['uz', 'ru'],
  supportPhone: '+998711234567',
  supportTelegram: '@demo_cafe',
  supportHours: '10:00-23:00',
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

const emptyRow = (id: string) => ({
  organization_id: id,
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
  created_at: new Date(),
  updated_at: new Date(),
});

describe('GET/PUT /organization/:id/settings', () => {
  let app: INestApplication;
  let rows: Record<string, any>;
  const invalidate = jest.fn();
  const A = `Bearer ${staffToken('owner-a')}`;
  const NO_ORG = `Bearer ${staffToken('no-org')}`;

  beforeAll(async () => {
    const prisma = {
      organization_settings: {
        findUnique: jest.fn(
          async ({ where }) => rows[where.organization_id] ?? null,
        ),
        update: jest.fn(async ({ where, data }) => {
          const row = { ...rows[where.organization_id], ...data };
          for (const key of ['theme', 'map_bounds']) {
            if (row[key] === Prisma.DbNull) row[key] = null;
          }
          rows[where.organization_id] = row;
          return row;
        }),
      },
    };
    app = await createHttpApp(
      {
        controllers: [OrganizationSettingsController],
        providers: [
          OrganizationSettingsService,
          OrganizationService,
          { provide: PrismaService, useValue: prisma },
          { provide: FileService, useValue: {} },
          { provide: RevalidateService, useValue: {} },
          { provide: TenantService, useValue: { invalidate } },
        ],
      },
      [
        { id: 'owner-a', organization: { id: ORG_A } },
        { id: 'no-org', organization: null },
      ],
    );
  });

  afterAll(() => app.close());
  beforeEach(() => {
    rows = { [ORG_A]: emptyRow(ORG_A), [ORG_B]: emptyRow(ORG_B) };
    invalidate.mockClear();
  });

  const get = (auth = A, id = ORG_A) => {
    const req = request(app.getHttpServer()).get(
      `/organization/${id}/settings`,
    );
    return auth ? req.set('Authorization', auth) : req;
  };
  const put = (body: unknown, auth = A, id = ORG_A) => {
    const req = request(app.getHttpServer()).put(
      `/organization/${id}/settings`,
    );
    return (auth ? req.set('Authorization', auth) : req).send(body as object);
  };

  it('returns the platform defaults written at signup', async () => {
    const res = await get().expect(200);
    expect(res.body).toEqual({
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

  it('replaces the settings, reads them back and refreshes the tenant cache', async () => {
    const res = await put(VALID).expect(200);
    expect(res.body).toEqual({ ...VALID, supportTelegram: 'demo_cafe' });
    expect(invalidate).toHaveBeenCalledWith(ORG_A);

    const again = await get().expect(200);
    expect(again.body).toEqual(res.body);
  });

  it('clears nullable fields with null', async () => {
    await put(VALID).expect(200);
    const kept = ['currency', 'defaultLanguage', 'languages'];
    const cleared = Object.fromEntries(
      Object.entries(VALID).map(([k, v]) => [k, kept.includes(k) ? v : null]),
    );
    const res = await put(cleared).expect(200);
    expect(res.body).toEqual(cleared);
  });

  it('401 without a token', async () => {
    await get('').expect(401);
    await put(VALID, '').expect(401);
  });

  it('403 for a user without an organization', async () => {
    await get(NO_ORG).expect(403);
    await put(VALID, NO_ORG).expect(403);
  });

  it('404 for the organization of another owner, which stays untouched', async () => {
    await get(A, ORG_B).expect(404);
    await put(VALID, A, ORG_B).expect(404);
    expect(rows[ORG_B].city).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each([
    ['color not hex', { theme: { brand: 'red' } }],
    ['color too long', { theme: { brand: '#EE2E17FF0' } }],
    ['unknown theme key', { theme: { brand: '#fff', accent: '#000' } }],
    ['unknown field', { extra: 1 }],
    ['currency not supported', { currency: 'USD' }],
    ['language outside ru, uz, en', { languages: ['uz', 'kk'] }],
    ['no languages', { languages: [] }],
    ['repeated language', { languages: ['uz', 'uz'] }],
    ['default language outside the list', { defaultLanguage: 'en' }],
    ['phone format', { supportPhone: '901234567' }],
    ['telegram username', { supportTelegram: 'ab' }],
    ['founded in the future', { foundedYear: 2999 }],
    ['founded too early', { foundedYear: 1200 }],
    ['latitude out of range', { mapCenter: { lat: 91, lng: 69 } }],
    ['longitude out of range', { mapCenter: { lat: 41, lng: -181 } }],
    ['center outside bounds', { mapCenter: { lat: 40, lng: 69.24 } }],
    ['zoom too large', { mapZoom: 22 }],
    ['zoom not integer', { mapZoom: 1.5 }],
    [
      'bounds inverted',
      {
        mapBounds: [
          [41.45, 69.45],
          [41.15, 69.0],
        ],
      },
    ],
    ['bounds malformed', { mapBounds: [41.15, 69.0] }],
    ['missing field', { city: undefined }],
  ])('400: %s', async (_name, patch) => {
    await put({ ...VALID, ...patch }).expect(400);
    expect(rows[ORG_A].city).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('500 settings_missing when the row does not exist, instead of defaults', async () => {
    delete rows[ORG_A];
    const res = await get().expect(500);
    expect(res.body.code).toBe('settings_missing');
  });
});
