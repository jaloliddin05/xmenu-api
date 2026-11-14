import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp, staffToken } from 'src/infra/testing/http-app.fake';
import { PrismaService } from '../_prisma/prisma.service';
import { BranchService } from '../branch/services/branch.service';
import { OrderSettingsService } from '../order/services/order-settings.service';
import { RevalidateService } from '../revalidate-queue/revalidate.service';
import { TenantService } from '../tenant/tenant.service';
import { BranchDeliveryPricingController } from './controllers/branch-delivery-pricing.controller';
import { DeliveryQuoteController } from './controllers/delivery-quote.controller';
import { DeliveryPricingService } from './services/delivery-pricing.service';
import { DeliveryQuoteService } from './services/delivery-quote.service';

const ORG_A = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const ORG_B = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const NEAR = '11111111-1111-4111-8111-111111111111';
const FAR = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

// About 0.009 degrees of latitude per km, north of the guest
const GUEST = { lat: 41.3, lng: 69.25 };
const north = (km: number) => GUEST.lat + km * 0.009;
const SQUARE = [
  [41.29, 69.24],
  [41.29, 69.26],
  [41.31, 69.26],
  [41.31, 69.24],
];

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
  distance: Record<string, any> | null;
}

describe('Delivery pricing (owner) and quote (guest)', () => {
  let app: INestApplication;
  let branches: FakeBranch[];
  let orgs: Record<
    string,
    { delivery_enabled: boolean; published_at: Date | null }
  >;
  let step: number;
  const revalidate = { addRevalidationJob: jest.fn(async () => undefined) };

  const withRules = (b: FakeBranch) => ({
    ...b,
    delivery_zones: [...b.zones].sort((x, y) => x.position - y.position),
    delivery_distance: b.distance,
  });

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const prisma = {
      branch: {
        findFirst: jest.fn(async ({ where }) => {
          const b = branches.find(
            (x) =>
              x.id === where.id && x.organization_id === where.organization_id,
          );
          return b ? withRules(b) : null;
        }),
        findMany: jest.fn(async ({ where }) =>
          branches
            .filter(
              (b) =>
                b.organization_id === where.organization_id &&
                (where.accepts_delivery === undefined ||
                  b.accepts_delivery === where.accepts_delivery),
            )
            .map(withRules),
        ),
      },
      branch_delivery_zone: {
        deleteMany: jest.fn(async ({ where }) => {
          branches.find((b) => b.id === where.branch_id)!.zones = [];
        }),
        createMany: jest.fn(async ({ data }) => {
          for (const z of data)
            branches.find((b) => b.id === z.branch_id)!.zones.push(z);
        }),
      },
      branch_delivery_distance: {
        deleteMany: jest.fn(async ({ where }) => {
          branches.find((b) => b.id === where.branch_id)!.distance = null;
        }),
        create: jest.fn(async ({ data }) => {
          branches.find((b) => b.id === data.branch_id)!.distance = data;
        }),
      },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) =>
        Promise.all(ops),
      ),
      organization: {
        findUnique: jest.fn(async ({ where }) => orgs[where.id] ?? null),
      },
      organization_order_settings: {
        findUnique: jest.fn(async ({ where }) => ({
          organization_id: where.organization_id,
          min_order_pickup: 0,
          delivery_price_step: step,
          courier_mode: 'own',
          acceptance_timeout_seconds: 300,
          payment_timeout_seconds: 900,
          max_active_orders: 5,
        })),
      },
    };
    app = await createHttpApp(
      {
        controllers: [BranchDeliveryPricingController, DeliveryQuoteController],
        providers: [
          DeliveryPricingService,
          DeliveryQuoteService,
          OrderSettingsService,
          { provide: PrismaService, useValue: prisma },
          { provide: RevalidateService, useValue: revalidate },
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
                    opensAt: b.isOpen ? null : '2026-11-15T09:00:00+05:00',
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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    step = 500;
    app.get(OrderSettingsService).invalidate(ORG_A);
    orgs = { [ORG_A]: { delivery_enabled: true, published_at: new Date() } };
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
      longitude: GUEST.lng,
      accepts_delivery: true,
      isOpen: true,
      zones: [],
      distance: {
        base_price: 8200,
        included_km: 2,
        price_per_km: 1500,
        max_km: 10,
        min_order: 30000,
        free_from: 150000,
      },
      ...over,
    });
    branches = [
      branch(FAR, 6),
      branch(NEAR, 2.5),
      branch(OTHER, 1, { organization_id: ORG_B }),
    ];
  });

  const owner = (method: 'get' | 'put', path: string, who = 'owner-a') =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${staffToken(who)}`);

  describe('GET/PUT /branch/:id/delivery-pricing', () => {
    const body = {
      zones: [
        { polygon: SQUARE, price: 7300, minOrder: 50000, freeFrom: null },
        { polygon: SQUARE, price: 9000, minOrder: 0 },
      ],
      distance: {
        basePrice: 8000,
        includedKm: 2,
        pricePerKm: 1500,
        maxKm: 10,
        minOrder: 30000,
        freeFrom: 150000,
      },
    };

    it('replaces the pricing as a whole: zones in the given order, missing freeFrom is null', async () => {
      const res = await owner('put', `/branch/${NEAR}/delivery-pricing`)
        .send(body)
        .expect(200);
      expect(res.body).toEqual({
        zones: [
          { polygon: SQUARE, price: 7300, minOrder: 50000, freeFrom: null },
          { polygon: SQUARE, price: 9000, minOrder: 0, freeFrom: null },
        ],
        distance: body.distance,
      });
      expect(revalidate.addRevalidationJob).toHaveBeenCalledWith({
        tenantId: ORG_A,
        route: 'branches',
      });

      const cleared = await owner('put', `/branch/${NEAR}/delivery-pricing`)
        .send({ zones: [], distance: null })
        .expect(200);
      expect(cleared.body).toEqual({ zones: [], distance: null });
      expect(
        (await owner('get', `/branch/${NEAR}/delivery-pricing`).expect(200))
          .body,
      ).toEqual({ zones: [], distance: null });
    });

    it("another venue's branch is 404 for reading and writing", async () => {
      await owner('get', `/branch/${OTHER}/delivery-pricing`).expect(404);
      await owner('put', `/branch/${OTHER}/delivery-pricing`)
        .send(body)
        .expect(404);
      expect(branches.find((b) => b.id === OTHER)!.zones).toEqual([]);
    });

    it('a broken polygon or maxKm below includedKm: 400 invalid_settings naming the field', async () => {
      const res = await owner('put', `/branch/${NEAR}/delivery-pricing`)
        .send({
          zones: [
            { polygon: SQUARE, price: 1, minOrder: 0 },
            {
              polygon: [
                [91, 69],
                [41, 69],
                [41, 70],
              ],
              price: 1,
              minOrder: 0,
            },
          ],
          distance: { ...body.distance, includedKm: 5, maxKm: 3 },
        })
        .expect(400);
      expect(res.body.code).toBe('invalid_settings');
      expect(res.body.fields.map((f: { field: string }) => f.field)).toEqual([
        'zones[1].polygon',
        'distance.maxKm',
      ]);
    });

    it('validates the shape: too few points, negative price, unknown field', async () => {
      const res = await owner('put', `/branch/${NEAR}/delivery-pricing`)
        .send({
          zones: [{ polygon: [[41, 69]], price: -1, minOrder: 0, eta: 30 }],
        })
        .expect(400);
      expect(res.body.code).toBe('validation_error');
      expect(res.body.fields.map((f: { field: string }) => f.field)).toEqual(
        expect.arrayContaining([
          'zones[0].polygon',
          'zones[0].price',
          'zones[0].eta',
        ]),
      );
    });

    it('needs an owner token', async () => {
      await request(app.getHttpServer())
        .get(`/branch/${NEAR}/delivery-pricing`)
        .expect(401);
    });
  });

  describe('GET /branch/:id/delivery-pricing/check', () => {
    const check = (lat: number, subtotal?: number, id = NEAR) =>
      owner(
        'get',
        `/branch/${id}/delivery-pricing/check?lat=${lat}&lng=${GUEST.lng}${
          subtotal === undefined ? '' : `&subtotal=${subtotal}`
        }`,
      );

    it('prices a point by distance with the venue step, regardless of hours', async () => {
      branches.find((b) => b.id === NEAR)!.isOpen = false;
      const res = await check(GUEST.lat, 10000).expect(200);
      // 2.5 km from the branch: base 8200 + 1 started km 1500 = 9700 → 10000 at step 500
      expect(res.body).toEqual({
        covered: true,
        rule: 'distance',
        zoneIndex: null,
        distanceKm: expect.closeTo(2.5, 1),
        deliveryFee: 10000,
        freeFrom: 150000,
        minOrder: 30000,
        shortBy: 20000,
      });
    });

    it('a point beyond every rule is not covered, with its distance', async () => {
      const res = await check(north(20)).expect(200);
      expect(res.body).toMatchObject({
        covered: false,
        rule: null,
        deliveryFee: null,
        distanceKm: expect.closeTo(17.5, 0),
      });
    });

    it("another venue's branch: 404; a bad point: 400", async () => {
      await check(GUEST.lat, 0, OTHER).expect(404);
      await check(95).expect(400);
    });
  });

  describe('GET /delivery/quote', () => {
    const quote = (lat: number, subtotal: number, tenant = ORG_A) =>
      request(app.getHttpServer())
        .get(`/delivery/quote?lat=${lat}&lng=${GUEST.lng}&subtotal=${subtotal}`)
        .set('X-Tenant-Id', tenant);

    it('the nearest open branch, its fee rounded to the venue step, not cached', async () => {
      const res = await quote(GUEST.lat, 40000).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toEqual({
        available: true,
        canOrder: true,
        reason: null,
        opensAt: null,
        branch: { id: NEAR, title: 'Near', address: 'Street' },
        rule: 'distance',
        distanceKm: expect.closeTo(2.5, 1),
        deliveryFee: 10000,
        freeFrom: 150000,
        minOrder: 30000,
        shortBy: 0,
      });
    });

    it('the nearest is closed: the next open branch delivers', async () => {
      branches.find((b) => b.id === NEAR)!.isOpen = false;
      const res = await quote(GUEST.lat, 40000).expect(200);
      expect(res.body.branch.id).toBe(FAR);
    });

    it('free delivery from the threshold', async () => {
      expect((await quote(GUEST.lat, 150000).expect(200)).body).toMatchObject({
        deliveryFee: 0,
        canOrder: true,
      });
    });

    it('below the minimum: available, cannot order, shortBy', async () => {
      expect((await quote(GUEST.lat, 25000).expect(200)).body).toMatchObject({
        available: true,
        canOrder: false,
        reason: 'min_order_not_reached',
        shortBy: 5000,
      });
    });

    it('all covering branches closed: branch_closed with the opening', async () => {
      for (const b of branches) b.isOpen = false;
      expect((await quote(GUEST.lat, 40000).expect(200)).body).toMatchObject({
        available: false,
        canOrder: false,
        reason: 'branch_closed',
        opensAt: '2026-11-15T09:00:00+05:00',
        branch: null,
        deliveryFee: null,
      });
    });

    it('outside every rule: out_of_delivery_zone', async () => {
      expect((await quote(north(-20), 40000).expect(200)).body.reason).toBe(
        'out_of_delivery_zone',
      );
    });

    it('no branch has rules: delivery_not_configured', async () => {
      for (const b of branches) b.distance = null;
      expect((await quote(GUEST.lat, 40000).expect(200)).body.reason).toBe(
        'delivery_not_configured',
      );
    });

    it('ordering paused or off: the ordering reason first', async () => {
      orgs[ORG_A].published_at = null;
      expect((await quote(GUEST.lat, 40000).expect(200)).body.reason).toBe(
        'ordering_not_published',
      );
      orgs[ORG_A].delivery_enabled = false;
      expect((await quote(GUEST.lat, 40000).expect(200)).body.reason).toBe(
        'ordering_channel_disabled',
      );
    });

    it('needs X-Tenant-Id and a valid point', async () => {
      await request(app.getHttpServer())
        .get(`/delivery/quote?lat=41&lng=69`)
        .expect(400);
      await quote(200, 0).expect(400);
    });
  });
});
