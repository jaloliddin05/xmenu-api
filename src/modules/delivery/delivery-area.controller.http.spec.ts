import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp, staffToken } from 'src/infra/testing/http-app.fake';
import { PrismaService } from '../_prisma/prisma.service';
import { BranchService } from '../branch/services/branch.service';
import { OrderSettingsService } from '../order/services/order-settings.service';
import { RevalidateService } from '../revalidate-queue/revalidate.service';
import { TenantService } from '../tenant/tenant.service';
import { BranchDeliveryPricingController } from './controllers/branch-delivery-pricing.controller';
import { DeliveryAreaPublicController } from './controllers/delivery-area-public.controller';
import { DeliveryAreaController } from './controllers/delivery-area.controller';
import { DeliveryQuoteController } from './controllers/delivery-quote.controller';
import { DeliveryRegionsController } from './controllers/delivery-regions.controller';
import { RegionCatalog } from './regions/region-catalog';
import { DeliveryAreaService } from './services/delivery-area.service';
import { DeliveryPricingService } from './services/delivery-pricing.service';
import { DeliveryQuoteService } from './services/delivery-quote.service';

const ORG_A = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const ORG_B = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const NEAR = '11111111-1111-4111-8111-111111111111';
const FAR = '22222222-2222-4222-8222-222222222222';

// Tashkent centre; about 0.009 degrees of latitude per km
const CENTRE = { lat: 41.3111, lng: 69.2797 };
const north = (km: number) => CENTRE.lat + km * 0.009;
/** A square around the centre, half a side of `km` (lng scaled for the latitude) */
const square = (km: number, lat = CENTRE.lat, lng = CENTRE.lng) => {
  const d = km * 0.009;
  const dl = km * 0.012;
  return [
    [lat - d, lng - dl],
    [lat - d, lng + dl],
    [lat + d, lng + dl],
    [lat + d, lng - dl],
  ];
};
const DEFAULT_RULE = {
  basePrice: 9000,
  includedKm: 2,
  pricePerKm: 1500,
  minOrder: 30000,
  freeFrom: null,
};

interface FakeBranch {
  id: string;
  organization_id: string;
  title: string;
  address: string;
  latitude: number;
  longitude: number;
  accepts_delivery: boolean;
  isOpen: boolean;
  zones: Record<string, any>[];
}

describe('Venue delivery area: owner, region catalog, guest map and quote', () => {
  let app: INestApplication;
  let catalog: RegionCatalog;
  let areas: Record<string, Record<string, any>>;
  let parts: Record<string, any>[];
  let branches: FakeBranch[];

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const prisma: Record<string, any> = {
      delivery_area: {
        findUnique: jest.fn(
          async ({ where }) => areas[where.organization_id] ?? null,
        ),
        deleteMany: jest.fn(async ({ where }) => {
          delete areas[where.organization_id];
        }),
        create: jest.fn(async ({ data }) => {
          areas[data.organization_id] = data;
        }),
      },
      delivery_area_part: {
        findMany: jest.fn(async ({ where }) =>
          parts
            .filter((p) => p.organization_id === where.organization_id)
            .sort((a, b) => a.position - b.position),
        ),
        deleteMany: jest.fn(async ({ where }) => {
          parts = parts.filter(
            (p) => p.organization_id !== where.organization_id,
          );
        }),
        createMany: jest.fn(async ({ data }) => {
          parts.push(...data);
        }),
      },
      // SELECT … FOR UPDATE of the venue row
      $queryRaw: jest.fn(async (_sql: unknown, id: string) =>
        [ORG_A, ORG_B].includes(id) ? [{ id }] : [],
      ),
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
      organization: {
        findUnique: jest.fn(async () => ({
          delivery_enabled: true,
          published_at: new Date(),
        })),
      },
      branch: {
        findFirst: jest.fn(async ({ where }) => {
          const b = branches.find(
            (x) =>
              x.id === where.id && x.organization_id === where.organization_id,
          );
          return b
            ? { ...b, delivery_zones: b.zones, delivery_distance: null }
            : null;
        }),
        findMany: jest.fn(async ({ where }) =>
          branches
            .filter((b) => b.organization_id === where.organization_id)
            .map((b) => ({
              ...b,
              delivery_zones: b.zones,
              delivery_distance: null,
            })),
        ),
      },
      organization_order_settings: {
        findUnique: jest.fn(async ({ where }) => ({
          organization_id: where.organization_id,
          min_order_pickup: 0,
          delivery_price_step: 500,
          courier_mode: 'own',
          acceptance_timeout_seconds: 300,
          payment_timeout_seconds: 900,
          max_active_orders: 5,
        })),
      },
    };
    app = await createHttpApp(
      {
        controllers: [
          BranchDeliveryPricingController,
          DeliveryAreaController,
          DeliveryAreaPublicController,
          DeliveryRegionsController,
          DeliveryQuoteController,
        ],
        providers: [
          DeliveryAreaService,
          RegionCatalog,
          DeliveryPricingService,
          DeliveryQuoteService,
          OrderSettingsService,
          { provide: PrismaService, useValue: prisma },
          {
            provide: RevalidateService,
            useValue: { addRevalidationJob: jest.fn() },
          },
          {
            provide: TenantService,
            useValue: {
              resolve: async (id: string) => ({
                id,
                slug: 'demo',
                brandName: 'Demo',
                defaultLanguage: 'ru',
                languages: ['ru'],
                currency: 'UZS',
              }),
            },
          },
          {
            provide: BranchService,
            useValue: {
              listActiveWithState: async (organizationId: string) =>
                branches
                  .filter((b) => b.organization_id === organizationId)
                  .map((b) => ({
                    branch: { ...b, accepts_pickup: true },
                    scheduled: true,
                    state: { isOpen: b.isOpen, opensAt: null, opensDate: null },
                    opensAt: b.isOpen ? null : '2026-11-25T09:00:00+05:00',
                  })),
            },
          },
        ],
      },
      [
        { id: 'owner-a', organization: { id: ORG_A } },
        { id: 'owner-b', organization: { id: ORG_B } },
      ],
    );
    catalog = app.get(RegionCatalog);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    areas = {};
    parts = [];
    const branch = (
      id: string,
      km: number,
      over: Partial<FakeBranch> = {},
    ): FakeBranch => ({
      id,
      organization_id: ORG_A,
      title: id === NEAR ? 'Near' : 'Far',
      address: 'Street',
      latitude: north(km),
      longitude: CENTRE.lng,
      accepts_delivery: true,
      isOpen: true,
      zones: [],
      ...over,
    });
    branches = [branch(NEAR, 1), branch(FAR, 4)];
  });

  const owner = (method: 'get' | 'put', path: string, who = 'owner-a') =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${staffToken(who)}`);
  const AREA = `/organization/${ORG_A}/delivery-area`;
  const TRIANGLE = [
    [41.351234567, 69.2],
    [41.35, 69.35],
    [41.25, 69.3],
  ];

  describe('GET/PUT /organization/:id/delivery-area', () => {
    it('replaces the area: a region copied from the catalog, a drawn part rounded to 6 decimals', async () => {
      const res = await owner('put', AREA)
        .send({
          parts: [
            { source: 'region', code: 'UZ-TK' },
            { source: 'custom', polygon: TRIANGLE },
          ],
          defaultRule: { ...DEFAULT_RULE, freeFrom: undefined },
        })
        .expect(200);
      const tk = catalog.find('UZ-TK')!;
      const expected = {
        parts: [
          {
            source: 'region',
            code: 'UZ-TK',
            name: tk.name,
            catalogVersion: catalog.version,
            rings: tk.rings,
          },
          {
            source: 'custom',
            code: null,
            name: null,
            catalogVersion: null,
            rings: [
              [
                [41.351235, 69.2],
                [41.35, 69.35],
                [41.25, 69.3],
              ],
            ],
          },
        ],
        defaultRule: DEFAULT_RULE,
      };
      expect(res.body).toEqual(expected);
      expect((await owner('get', AREA).expect(200)).body).toEqual(expected);
    });

    it('no parts removes the area and its default price', async () => {
      await owner('put', AREA)
        .send({
          parts: [{ source: 'region', code: 'UZ-TK' }],
          defaultRule: DEFAULT_RULE,
        })
        .expect(200);
      const res = await owner('put', AREA)
        .send({ parts: [], defaultRule: DEFAULT_RULE })
        .expect(200);
      expect(res.body).toEqual({ parts: [], defaultRule: null });
    });

    it('400 invalid_settings naming the field: unknown region, swapped lat/lng, crossing outline, no default price', async () => {
      const res = await owner('put', AREA)
        .send({
          parts: [
            { source: 'region', code: 'UZ-XX' },
            {
              source: 'custom',
              polygon: TRIANGLE.map(([lat, lng]) => [lng, lat]),
            },
            {
              source: 'custom',
              polygon: [
                [41.2, 69.2],
                [41.3, 69.3],
                [41.3, 69.2],
                [41.2, 69.3],
              ],
            },
          ],
        })
        .expect(400);
      expect(res.body.code).toBe('invalid_settings');
      expect(res.body.fields).toEqual([
        expect.objectContaining({
          field: 'parts[0].code',
          code: 'unknown_region',
        }),
        expect.objectContaining({
          field: 'parts[1].polygon',
          code: 'outside_bounds',
        }),
        expect.objectContaining({
          field: 'parts[2].polygon',
          code: 'self_intersection',
        }),
        expect.objectContaining({ field: 'defaultRule', code: 'required' }),
      ]);
      expect(parts).toEqual([]);
    });

    it('400 validation_error for the shape: unknown source, too few points, negative price', async () => {
      const res = await owner('put', AREA)
        .send({
          parts: [
            { source: 'circle' },
            { source: 'custom', polygon: TRIANGLE.slice(0, 2) },
          ],
          defaultRule: { ...DEFAULT_RULE, basePrice: -1 },
        })
        .expect(400);
      expect(res.body.code).toBe('validation_error');
      expect(res.body.fields.map((f: { field: string }) => f.field)).toEqual(
        expect.arrayContaining([
          'parts[0].source',
          'parts[1].polygon',
          'defaultRule.basePrice',
        ]),
      );
    });

    it('takes a body over the API-wide 100 KB, refuses one over 1 MB with payload_too_large', async () => {
      const json = (padding: number) =>
        JSON.stringify({
          parts: [{ source: 'custom', polygon: TRIANGLE }],
          defaultRule: DEFAULT_RULE,
        }).replace('{', '{' + ' '.repeat(padding));
      await owner('put', AREA)
        .set('Content-Type', 'application/json')
        .send(json(300_000))
        .expect(200);
      const res = await owner('put', AREA)
        .set('Content-Type', 'application/json')
        .send(json(1_100_000))
        .expect(413);
      expect(res.body.code).toBe('payload_too_large');
    });

    it("another venue's id: 404; no token: 401", async () => {
      await owner('get', `/organization/${ORG_B}/delivery-area`).expect(404);
      await owner('put', `/organization/${ORG_B}/delivery-area`)
        .send({ parts: [], defaultRule: null })
        .expect(404);
      await request(app.getHttpServer()).get(AREA).expect(401);
    });
  });

  describe('GET /delivery/regions', () => {
    it('lists the 14 regions with names, bbox, version and attribution', async () => {
      const res = await owner('get', '/delivery/regions').expect(200);
      expect(res.body.regions).toHaveLength(14);
      expect(res.body.regions[0]).toEqual({
        code: 'UZ-AN',
        name: expect.objectContaining({ ru: 'Андижанская область' }),
        bbox: [
          [expect.any(Number), expect.any(Number)],
          [expect.any(Number), expect.any(Number)],
        ],
      });
      expect(res.body.regions[0].rings).toBeUndefined();
      expect(res.body).toMatchObject({
        version: catalog.version,
        attribution: '© OpenStreetMap contributors',
        license: 'ODbL-1.0',
      });
    });

    it('one region with its rings; unknown code: 404 not_found; no token: 401', async () => {
      const res = await owner('get', '/delivery/regions/UZ-FA').expect(200);
      expect(res.body).toMatchObject({
        code: 'UZ-FA',
        version: catalog.version,
      });
      expect(res.body.rings).toEqual(catalog.find('UZ-FA')!.rings);
      expect(
        (await owner('get', '/delivery/regions/UZ-XX').expect(404)).body.code,
      ).toBe('not_found');
      await request(app.getHttpServer()).get('/delivery/regions').expect(401);
    });
  });

  describe('GET /delivery/area (guest)', () => {
    const guest = () =>
      request(app.getHttpServer())
        .get('/delivery/area')
        .set('X-Tenant-Id', ORG_A);

    it('no area: parts null, cached publicly with an ETag', async () => {
      const res = await guest().expect(200);
      expect(res.body).toEqual({ parts: null });
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      expect(res.headers.etag).toEqual(expect.any(String));
    });

    it('the parts with 5 decimals; the same ETag answers 304', async () => {
      await owner('put', AREA)
        .send({
          parts: [{ source: 'custom', polygon: TRIANGLE }],
          defaultRule: DEFAULT_RULE,
        })
        .expect(200);
      const res = await guest().expect(200);
      expect(res.body).toEqual({
        parts: [
          [
            [
              // From the stored 41.351235 (6 decimals)
              [41.35124, 69.2],
              [41.35, 69.35],
              [41.25, 69.3],
            ],
          ],
        ],
      });
      await guest().set('If-None-Match', res.headers.etag).expect(304);
    });

    it('needs X-Tenant-Id', async () => {
      await request(app.getHttpServer()).get('/delivery/area').expect(400);
    });
  });

  describe('GET /delivery/quote with the area', () => {
    const quote = (lat: number, lng = CENTRE.lng, subtotal = 50000) =>
      request(app.getHttpServer())
        .get('/delivery/quote')
        .query({ lat, lng, subtotal })
        .set('X-Tenant-Id', ORG_A);
    const setArea = () =>
      owner('put', AREA)
        .send({
          parts: [{ source: 'custom', polygon: square(8) }],
          defaultRule: DEFAULT_RULE,
        })
        .expect(200);

    it('outside the area: out_of_delivery_zone', async () => {
      await setArea();
      const res = await quote(north(12)).expect(200);
      expect(res.body).toMatchObject({
        available: false,
        reason: 'out_of_delivery_zone',
      });
    });

    it('a gap no branch rule covers: the nearest open branch at the default price', async () => {
      await setArea();
      // 5.5 km north: 4.5 km from NEAR, 1.5 km from FAR
      const res = await quote(north(5.5)).expect(200);
      expect(res.body).toMatchObject({
        available: true,
        canOrder: true,
        rule: 'default',
        branch: { id: FAR },
        // Within the 2 included km: the base price
        deliveryFee: 9000,
        minOrder: 30000,
      });
    });

    it('a branch zone inside the area prices the address', async () => {
      branches[0].zones = [
        {
          position: 0,
          polygon: square(1, north(-2)),
          price: 4000,
          min_order: 0,
          free_from: null,
        },
      ];
      await setArea();
      const res = await quote(north(-2)).expect(200);
      expect(res.body).toMatchObject({
        rule: 'zone',
        branch: { id: NEAR },
        deliveryFee: 4000,
      });
    });

    it('no area and no branch rules: delivery_not_configured, as before', async () => {
      const res = await quote(north(6)).expect(200);
      expect(res.body).toMatchObject({
        available: false,
        reason: 'delivery_not_configured',
      });
    });
  });

  describe('GET /branch/:id/delivery-pricing/check with the area', () => {
    const check = (lat: number, id = NEAR) =>
      owner(
        'get',
        `/branch/${id}/delivery-pricing/check?lat=${lat}&lng=${CENTRE.lng}&subtotal=50000`,
      );
    const setArea = () =>
      owner('put', AREA)
        .send({
          parts: [{ source: 'custom', polygon: square(8) }],
          defaultRule: DEFAULT_RULE,
        })
        .expect(200);

    it('outside the area: not covered, out_of_delivery_zone', async () => {
      await setArea();
      const res = await check(north(12)).expect(200);
      expect(res.body).toMatchObject({
        covered: false,
        inArea: false,
        reason: 'out_of_delivery_zone',
        rule: null,
        deliveryFee: null,
      });
    });

    it('inside the area, no branch rule: the default price from this branch', async () => {
      await setArea();
      // 5.5 km north: 4.5 km from NEAR (2 included, 3 started km at 1500)
      const res = await check(north(5.5)).expect(200);
      expect(res.body).toEqual({
        covered: true,
        inArea: true,
        reason: null,
        rule: 'default',
        zoneIndex: null,
        distanceKm: expect.closeTo(4.5, 1),
        deliveryFee: 13500,
        freeFrom: null,
        minOrder: 30000,
        shortBy: 0,
      });
    });

    it('a branch zone inside the area wins over the default price', async () => {
      branches[0].zones = [
        {
          position: 0,
          polygon: square(1, north(-2)),
          price: 4000,
          min_order: 0,
          free_from: null,
        },
      ];
      await setArea();
      const res = await check(north(-2)).expect(200);
      expect(res.body).toMatchObject({
        covered: true,
        inArea: true,
        rule: 'zone',
        zoneIndex: 0,
        deliveryFee: 4000,
      });
    });

    it('no area: inArea null, the branch rules alone', async () => {
      const res = await check(north(5.5)).expect(200);
      expect(res.body).toMatchObject({
        covered: false,
        inArea: null,
        reason: 'out_of_delivery_zone',
      });
    });
  });
});
