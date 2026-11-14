import { PLATFORM_THEME } from 'src/modules/organization/domain/platform-defaults';
import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp } from 'src/infra/testing/http-app.fake';
import { PrismaService } from '../_prisma/prisma.service';
import { OrderSettingsService } from '../order/services/order-settings.service';
import { TenantConfigController } from './tenant-config.controller';
import { TenantConfigService } from './tenant-config.service';
import { TenantService } from './tenant.service';
import { GuestLoginService } from '../guest-login/guest-login.service';
import { TelegramBotService } from '../telegram/telegram-bot.service';
import { OpsNotifierService } from '../order/notifications/ops-notifier.service';
import { REDIS } from 'src/infra/redis/redis.module';
import { DeliveryPricingService } from '../delivery/services/delivery-pricing.service';

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
const ordering = (courierMode = 'own') => ({
  min_order_pickup: 0,
  delivery_price_step: 100,
  courier_mode: courierMode,
  acceptance_timeout_seconds: 300,
  payment_timeout_seconds: 900,
  max_active_orders: 5,
});
/** A delivering branch priced by one zone, or by the distance rule only (no zone to draw). */
const zoneRules = (zone: number[][]) => ({
  zones: [{ polygon: zone, price: 10000, minOrder: 0, freeFrom: null }],
  distance: null,
});
const distanceRules = {
  zones: [],
  distance: {
    basePrice: 8000,
    includedKm: 2,
    pricePerKm: 1000,
    maxKm: 10,
    minOrder: 0,
    freeFrom: null,
  },
};

describe('GET /tenant/config', () => {
  let app: INestApplication;
  let orgs: Record<string, any>;
  let orderRows: Record<string, any>;
  let branches: Record<string, any[]>;
  // DeliveryPricingService.pricedDeliveryBranches: rules of the delivering branches that have any
  let priced: Record<string, { zones: any[]; distance: any }[]>;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    process.env.PUBLIC_FILES_URL = 'https://files.example';
    process.env.SMS_PROVIDER = 'console';
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
        GuestLoginService,
        { provide: PrismaService, useValue: prisma },
        // usable(): an enabled bot whose token decrypts; the fixture says it with telegram_bot.usable
        {
          provide: TelegramBotService,
          useValue: {
            usable: async (id: string) => {
              const bot = orgs[id]?.telegram_bot;
              return !!bot?.is_enabled && bot.usable !== false;
            },
          },
        },
        { provide: OpsNotifierService, useValue: { alert: jest.fn() } },
        { provide: REDIS, useValue: { set: jest.fn(async () => 'OK') } },
        {
          provide: DeliveryPricingService,
          useValue: {
            pricedDeliveryBranches: async (id: string) =>
              (priced[id] ?? []).map((rules, i) => ({ id: `b${i}`, rules })),
          },
        },
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
        qr_enabled: true,
        delivery_enabled: true,
        delivery_mode: 'both',
        published_at: new Date('2026-10-31T10:00:00Z'),
        telegram_bot: { is_enabled: true, username: 'demo_cafe_bot' },
        logo: { url: '/image/organization/logo.png' },
        banner: null,
        // PRIMARY_DOMAIN_SELECT result: the earliest verified domain
        domains: [{ host: 'order.cafe-example.uz' }],
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
        qr_enabled: true,
        delivery_enabled: false,
        delivery_mode: 'site',
        published_at: null,
        telegram_bot: null,
        logo: null,
        banner: null,
        domains: [],
        translations: [
          { lang: 'ru', description: '' },
          { lang: 'uz', description: '' },
        ],
        settings: settings(),
      },
      [OFF]: { id: OFF, slug: 'off', name: 'Off', is_active: false },
    };
    orderRows = { [FULL]: ordering(), [BARE]: ordering() };
    priced = { [FULL]: [zoneRules(ZONE)] };
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
      primaryDomain: 'order.cafe-example.uz',
      type: 'cafe',
      logoUrl: 'https://files.example/image/organization/logo.png',
      bannerUrl: null,
      description: 'Описание',
      foundedYear: 2015,
      theme: { ...PLATFORM_THEME, brand: '#EE2E17' },
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
      channels: {
        qr: true,
        auth: { sms: true, telegram: true },
        delivery: {
          enabled: true,
          mode: 'both',
          published: true,
          miniApp: true,
          botUsername: 'demo_cafe_bot',
        },
      },
      fulfillment: {
        modes: ['delivery', 'pickup'],
        defaultMode: 'delivery',
        deliveryOffered: true,
        deliveryAvailable: true,
        deliveryUnavailableReason: null,
        courierMode: 'own',
        cashOnDelivery: true,
      },
      map: {
        center: [41.31, 69.24],
        centerSource: 'saved',
        zoom: 15,
        city: 'Tashkent',
        bounds: [
          [41.15, 69.0],
          [41.45, 69.45],
        ],
        deliveryZones: [ZONE],
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

  it('answers null for everything the owner has not filled in, except the theme: platform neutral colors', async () => {
    const res = await config(BARE).expect(200);
    expect(res.body).toEqual({
      id: BARE,
      slug: 'bare-cafe',
      name: 'Bare',
      primaryDomain: null,
      type: 'other',
      logoUrl: null,
      bannerUrl: null,
      description: null,
      foundedYear: null,
      theme: PLATFORM_THEME,
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
      channels: {
        qr: true,
        auth: { sms: true, telegram: false },
        delivery: {
          enabled: false,
          mode: 'site',
          published: false,
          miniApp: false,
          botUsername: null,
        },
      },
      fulfillment: {
        modes: [],
        defaultMode: null,
        deliveryOffered: false,
        deliveryAvailable: false,
        deliveryUnavailableReason: 'not_offered',
        courierMode: 'own',
        cashOnDelivery: true,
      },
      map: {
        center: null,
        centerSource: null,
        zoom: null,
        city: null,
        bounds: null,
        deliveryZones: [],
      },
    });
  });

  const publishBare = () =>
    Object.assign(orgs[BARE], {
      delivery_enabled: true,
      published_at: new Date('2026-10-31T10:00:00Z'),
    });

  it('offers delivery only when a delivering branch has pricing', async () => {
    publishBare();
    branches[BARE] = [
      { is_active: true, accepts_delivery: true, accepts_pickup: true },
      { is_active: false, accepts_delivery: true, accepts_pickup: true },
    ];
    const res = await config(BARE).expect(200);
    expect(res.body.fulfillment).toEqual({
      modes: ['pickup'],
      defaultMode: 'pickup',
      deliveryOffered: true,
      deliveryAvailable: false,
      deliveryUnavailableReason: 'not_configured',
      courierMode: 'own',
      cashOnDelivery: true,
    });
    // A distance rule alone is enough; there is no zone to draw
    priced[BARE] = [distanceRules];
    const priced2 = await config(BARE).expect(200);
    expect(priced2.body.fulfillment.modes).toEqual(['delivery', 'pickup']);
    expect(priced2.body.map.deliveryZones).toEqual([]);
  });

  it('external couriers only: no cash on delivery', async () => {
    orderRows[FULL] = ordering('external');
    const { fulfillment } = (await config(FULL).expect(200)).body;
    expect(fulfillment).toMatchObject({
      courierMode: 'external',
      cashOnDelivery: false,
    });
  });

  it('says delivery is not offered when no active branch takes it, even if pickup works', async () => {
    publishBare();
    branches[BARE] = [
      { is_active: true, accepts_delivery: false, accepts_pickup: true },
    ];
    priced[BARE] = [zoneRules(ZONE)];
    app.get(OrderSettingsService).invalidate(BARE);
    const res = await config(BARE).expect(200);
    expect(res.body.fulfillment).toEqual({
      modes: ['pickup'],
      defaultMode: 'pickup',
      deliveryOffered: false,
      deliveryAvailable: false,
      deliveryUnavailableReason: 'not_offered',
      courierMode: 'own',
      cashOnDelivery: true,
    });
  });

  it.each<[string, Record<string, unknown>, string]>([
    [
      'ordering is off',
      { delivery_enabled: false, published_at: null },
      'channel_disabled',
    ],
    [
      'ordering is on but not published',
      { delivery_enabled: true, published_at: null },
      'not_published',
    ],
    [
      'ordering is off with a stale publication',
      {
        delivery_enabled: false,
        published_at: new Date('2026-10-31T10:00:00Z'),
      },
      'channel_disabled',
    ],
  ])(
    'offers no mode while %s, whatever the branches and zone',
    async (_, state, reason) => {
      Object.assign(orgs[FULL], state);
      const res = await config(FULL).expect(200);
      expect(res.body.fulfillment).toEqual({
        modes: [],
        defaultMode: null,
        deliveryOffered: true,
        deliveryAvailable: false,
        deliveryUnavailableReason: reason,
        courierMode: 'own',
        cashOnDelivery: true,
      });
      expect(res.body.channels.delivery).toEqual({
        enabled: state.delivery_enabled,
        mode: 'both',
        published: false,
        miniApp: true,
        botUsername: 'demo_cafe_bot',
      });
      // The map and zone stay: the site can still show them while orders are paused
      expect(res.body.map.deliveryZones).toEqual([ZONE]);
    },
  );

  describe('map view without a saved center', () => {
    const unsave = () =>
      Object.assign(orgs[FULL].settings, {
        map_center_lat: null,
        map_center_lng: null,
        map_zoom: null,
      });

    it('centers on the delivery zone', async () => {
      unsave();
      const { map } = (await config(FULL).expect(200)).body;
      expect(map.centerSource).toBe('zone');
      expect(map.center[0]).toBeCloseTo(41.3575, 6);
      expect(map.center[1]).toBeCloseTo(69.2655, 6);
      expect(map.zoom).toBe(12);
    });

    it('centers on the branches when there is no zone, skipping (0, 0) and inactive ones', async () => {
      unsave();
      priced[FULL] = [];
      branches[FULL] = [
        { is_active: true, latitude: 41.3, longitude: 69.2 },
        { is_active: true, latitude: 41.32, longitude: 69.3 },
        { is_active: true, latitude: 0, longitude: 0 },
        { is_active: false, latitude: 10, longitude: 10 },
      ];
      const { map } = (await config(FULL).expect(200)).body;
      expect(map.centerSource).toBe('branches');
      expect(map.center[0]).toBeCloseTo(41.31, 6);
      expect(map.center[1]).toBeCloseTo(69.25, 6);
    });

    it('keeps the saved zoom next to a computed center', async () => {
      unsave();
      orgs[FULL].settings.map_zoom = 14;
      const { map } = (await config(FULL).expect(200)).body;
      expect(map.centerSource).toBe('zone');
      expect(map.zoom).toBe(14);
    });

    it('stays null for a venue with neither zone nor branch coordinates', async () => {
      unsave();
      priced[FULL] = [];
      branches[FULL] = [{ is_active: true, latitude: 0, longitude: 0 }];
      const { map } = (await config(FULL).expect(200)).body;
      expect(map.center).toBeNull();
      expect(map.centerSource).toBeNull();
    });
  });

  it('reports which ways of confirming a phone work', async () => {
    orgs[FULL].telegram_bot = { is_enabled: false };
    expect((await config(FULL).expect(200)).body.channels.auth).toEqual({
      sms: true,
      telegram: false,
    });
  });

  it('does not offer Telegram when the bot token cannot be decrypted (W9-05)', async () => {
    orgs[FULL].telegram_bot = { is_enabled: true, usable: false };
    expect((await config(FULL).expect(200)).body.channels.auth).toEqual({
      sms: true,
      telegram: false,
    });
  });

  it.each([
    ['miniapp with a working bot', 'miniapp', { is_enabled: true }, true],
    ['both with a working bot', 'both', { is_enabled: true }, true],
    ['site with a working bot', 'site', { is_enabled: true }, false],
    ['miniapp with a disabled bot', 'miniapp', { is_enabled: false }, false],
    [
      'miniapp with an unreadable token',
      'miniapp',
      { is_enabled: true, usable: false },
      false,
    ],
    ['miniapp after the bot was removed', 'miniapp', null, false],
  ] as const)('Mini App: %s → miniApp %s', async (_why, mode, bot, miniApp) => {
    orgs[FULL].delivery_mode = mode;
    orgs[FULL].telegram_bot = bot && { ...bot, username: 'demo_cafe_bot' };
    const { delivery } = (await config(FULL).expect(200)).body.channels;
    expect(delivery).toMatchObject({
      mode,
      miniApp,
      botUsername: miniApp ? 'demo_cafe_bot' : null,
    });
  });

  it('reports no SMS when the telegram test provider lacks its bot or chat', async () => {
    const saved = { ...process.env };
    try {
      process.env.SMS_PROVIDER = 'telegram';
      delete process.env.OTP_BOT;
      process.env.XMENU_CHAT_ID = '-100';
      expect((await config(FULL).expect(200)).body.channels.auth.sms).toBe(
        false,
      );
      process.env.OTP_BOT = '1:T';
      expect((await config(FULL).expect(200)).body.channels.auth.sms).toBe(
        true,
      );
    } finally {
      process.env = saved;
    }
  });

  it('reports a QR menu the owner turned off', async () => {
    orgs[FULL].qr_enabled = false;
    expect((await config(FULL).expect(200)).body.channels.qr).toBe(false);
  });

  it('ignores inactive branches', async () => {
    publishBare();
    branches[BARE] = [
      { is_active: false, accepts_delivery: true, accepts_pickup: true },
    ];
    expect((await config(BARE).expect(200)).body.fulfillment.modes).toEqual([]);
  });

  it('400 tenant_required without X-Tenant-Id', async () => {
    const res = await config().expect(400);
    expect(res.body.code).toBe('tenant_required');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['a slug', 'cafe-example'],
    ['an unknown id', '11111111-2222-4333-8444-555555555555'],
  ])('404 tenant_not_found for %s', async (_name, key) => {
    const res = await config(key).expect(404);
    expect(res.body.code).toBe('tenant_not_found');
  });

  it('403 tenant_inactive for an unpublished venue', async () => {
    const res = await config(OFF).expect(403);
    expect(res.body.code).toBe('tenant_inactive');
  });

  it('500 settings_missing when the ordering settings row is gone', async () => {
    delete orderRows[FULL];
    const res = await config(FULL).expect(500);
    expect(res.body.code).toBe('settings_missing');
  });
});
