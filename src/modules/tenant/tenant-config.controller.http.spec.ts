import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp } from 'src/infra/testing/http-app.fake';
import { PrismaService } from '../_prisma/prisma.service';
import { OrderSettingsService } from '../order/services/order-settings.service';
import { TenantConfigController } from './tenant-config.controller';
import { TenantConfigService } from './tenant-config.service';
import { TenantService } from './tenant.service';

const FULL = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const BARE = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const OFF = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';
const ZONE = [
  [41.361, 69.201],
  [41.37, 69.28],
  [41.345, 69.33],
];

const settings = (over: Record<string, unknown> = {}) => ({
  organization_id: 'x',
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
  ...over,
});
const ordering = (zone: unknown) => ({
  delivery_service_fee: 0,
  min_order_delivery: 0,
  min_order_pickup: 0,
  eta_min: 20,
  eta_max: 30,
  acceptance_timeout_seconds: 300,
  payment_timeout_seconds: 900,
  max_active_orders: 5,
  delivery_zone: zone,
});

describe('GET /tenant/config', () => {
  let app: INestApplication;
  let orgs: Record<string, any>;
  let orderRows: Record<string, any>;
  let branches: Record<string, any[]>;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    process.env.PUBLIC_FILES_URL = 'https://files.example';
    const prisma = {
      organization: {
        findUnique: jest.fn(async ({ where }) => orgs[where.id] ?? null),
      },
      organization_order_settings: {
        findUnique: jest.fn(
          async ({ where }) => orderRows[where.organization_id] ?? null,
        ),
      },
      branch: {
        findMany: jest.fn(async ({ where }) =>
          (branches[where.organization_id] ?? []).filter(
            (b) => b.is_active === where.is_active,
          ),
        ),
      },
    };
    app = await createHttpApp({
      controllers: [TenantConfigController],
      providers: [
        TenantConfigService,
        TenantService,
        OrderSettingsService,
        { provide: PrismaService, useValue: prisma },
      ],
    });
  });

  afterAll(async () => {
    delete process.env.PUBLIC_FILES_URL;
    await app.close();
  });

  beforeEach(() => {
    orgs = {
      [FULL]: {
        id: FULL,
        slug: 'cafe-example',
        name: 'Demo Cafe',
        type: 'cafe',
        is_active: true,
        logo: { url: '/image/organization/logo.png' },
        banner: null,
        translations: [
          { lang: 'ru', description: 'Описание' },
          { lang: 'uz', description: 'Tavsif' },
          { lang: 'en', description: '  ' },
        ],
        settings: settings({
          theme: { brand: '#EE2E17', danger: 'not-a-color' },
          default_language: 'uz',
          languages: ['uz', 'ru', 'en'],
          support_phone: '+998711234567',
          support_telegram: 'demo_cafe',
          support_hours: '10:00-23:00',
          address: 'Main street 1',
          founded_year: 2015,
          city: 'Tashkent',
          map_center_lat: 41.31,
          map_center_lng: 69.24,
          map_zoom: 15,
          map_bounds: [
            [41.15, 69.0],
            [41.45, 69.45],
          ],
        }),
      },
      [BARE]: {
        id: BARE,
        slug: 'bare-cafe',
        name: 'Bare',
        type: 'other',
        is_active: true,
        logo: null,
        banner: null,
        translations: [
          { lang: 'ru', description: '' },
          { lang: 'uz', description: '' },
        ],
        settings: settings(),
      },
      [OFF]: { id: OFF, slug: 'off', name: 'Off', is_active: false },
    };
    orderRows = { [FULL]: ordering(ZONE), [BARE]: ordering(null) };
    branches = {
      [FULL]: [
        { is_active: true, accepts_delivery: true, accepts_pickup: false },
        { is_active: true, accepts_delivery: false, accepts_pickup: true },
      ],
    };
    app.get(TenantService).invalidate(FULL);
    app.get(TenantService).invalidate(BARE);
    app.get(OrderSettingsService).invalidate(FULL);
    app.get(OrderSettingsService).invalidate(BARE);
  });

  const config = (tenant?: string, lang?: string) => {
    let req = request(app.getHttpServer()).get('/tenant/config');
    if (tenant) req = req.set('X-Tenant-Id', tenant);
    if (lang) req = req.set('Accept-Language', lang);
    return req;
  };

  it('returns the full configuration in the requested language, cacheable per tenant and language', async () => {
    const res = await config(FULL, 'ru-RU,ru;q=0.9').expect(200);
    expect(res.body).toEqual({
      id: FULL,
      slug: 'cafe-example',
      name: 'Demo Cafe',
      type: 'cafe',
      logoUrl: 'https://files.example/image/organization/logo.png',
      bannerUrl: null,
      description: 'Описание',
      foundedYear: 2015,
      theme: { brand: '#EE2E17' },
      locale: {
        defaultLanguage: 'uz',
        languages: ['uz', 'ru', 'en'],
        currency: 'UZS',
      },
      contacts: {
        phone: '+998711234567',
        telegramUsername: 'demo_cafe',
        workingHours: '10:00-23:00',
        address: 'Main street 1',
      },
      fulfillment: { modes: ['delivery', 'pickup'], defaultMode: 'delivery' },
      map: {
        center: [41.31, 69.24],
        zoom: 15,
        city: 'Tashkent',
        bounds: [
          [41.15, 69.0],
          [41.45, 69.45],
        ],
        deliveryZone: ZONE,
      },
    });
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.headers['vary']).toBe('X-Tenant-Id, Accept-Language');
  });

  it("falls back to the venue's default language for a blank or missing description", async () => {
    expect((await config(FULL, 'en').expect(200)).body.description).toBe(
      'Tavsif',
    );
    expect((await config(FULL).expect(200)).body.description).toBe('Tavsif');
  });

  it('answers null for everything the owner has not filled in, inventing nothing', async () => {
    const res = await config(BARE).expect(200);
    expect(res.body).toEqual({
      id: BARE,
      slug: 'bare-cafe',
      name: 'Bare',
      type: 'other',
      logoUrl: null,
      bannerUrl: null,
      description: null,
      foundedYear: null,
      theme: null,
      locale: {
        defaultLanguage: 'ru',
        languages: ['ru', 'uz', 'en'],
        currency: 'UZS',
      },
      contacts: {
        phone: null,
        telegramUsername: null,
        workingHours: null,
        address: null,
      },
      fulfillment: { modes: [], defaultMode: null },
      map: {
        center: null,
        zoom: null,
        city: null,
        bounds: null,
        deliveryZone: null,
      },
    });
  });

  it('offers delivery only with a delivery zone', async () => {
    branches[BARE] = [
      { is_active: true, accepts_delivery: true, accepts_pickup: true },
      { is_active: false, accepts_delivery: true, accepts_pickup: true },
    ];
    const res = await config(BARE).expect(200);
    expect(res.body.fulfillment).toEqual({
      modes: ['pickup'],
      defaultMode: 'pickup',
    });
  });

  it('ignores inactive branches', async () => {
    branches[BARE] = [
      { is_active: false, accepts_delivery: true, accepts_pickup: true },
    ];
    expect((await config(BARE).expect(200)).body.fulfillment.modes).toEqual([]);
  });

  it('400 tenant_required without X-Tenant-Id', async () => {
    const res = await config().expect(400);
    expect(res.body.error.code).toBe('tenant_required');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['a slug', 'cafe-example'],
    ['an unknown id', '11111111-2222-4333-8444-555555555555'],
  ])('404 tenant_not_found for %s', async (_name, key) => {
    const res = await config(key).expect(404);
    expect(res.body.error.code).toBe('tenant_not_found');
  });

  it('403 tenant_inactive for an unpublished venue', async () => {
    const res = await config(OFF).expect(403);
    expect(res.body.error.code).toBe('tenant_inactive');
  });

  it('500 settings_missing when the ordering settings row is gone', async () => {
    delete orderRows[FULL];
    const res = await config(FULL).expect(500);
    expect(res.body.error.code).toBe('settings_missing');
  });
});
