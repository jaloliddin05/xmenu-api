import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp, staffToken } from 'src/infra/testing/http-app.fake';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { OrderBoardService } from '../services/order-board.service';
import { OrderSettingsService } from '../services/order-settings.service';
import { OrderStaffService } from '../services/order-staff.service';
import { StaffOrderController } from './staff-order.controller';

/** GET /order/board (docs/API.md, "Доска заказов"): the light board of live orders. */
const ORG = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const FOREIGN_BRANCH = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-11-24T12:00:00Z');
const ago = (m: number) => new Date(now.getTime() - m * 60_000);

const row = (extra: Record<string, unknown>) => ({
  id: 'o-1',
  number: 1001,
  status: 'accepted',
  fulfillment: 'delivery',
  version: 2,
  created_at: ago(20),
  address_snapshot: {
    address: 'Amir Temur 15',
    entrance: '2',
    floor: '5',
    apartment: '51',
    comment: 'домофон',
  },
  total: 125_000,
  currency: 'UZS',
  payment_method: 'cash',
  cash_change_from: 200_000,
  courier_id: null,
  ready_at: null,
  picked_up_at: null,
  courier: null,
  pos_order: null,
  items: [{ name: 'Плов', quantity: 2, position: 0 }],
  events: [],
  // what the select leaves out must never reach the answer even if the query returned it
  phone: '+998901112233',
  customer: { name: 'Aziza', phone: '+998901112233' },
  comment: 'secret comment',
  ...extra,
});

describe('GET /order/board', () => {
  let app: INestApplication;
  let rows: Record<string, unknown>[];
  let findMany: jest.Mock;
  let placedWhere: unknown;
  let trackPreparation: boolean;
  let integration: { status: string; courier_mode: string } | null;

  beforeAll(async () => {
    findMany = jest.fn(async () => rows);
    const prisma = {
      branch: {
        findFirst: jest.fn(async ({ where }) =>
          where.id === BRANCH && where.organization_id === ORG
            ? { id: BRANCH }
            : null,
        ),
      },
      customer_order: {
        findMany,
        count: jest.fn(async ({ where }) => {
          placedWhere = where;
          return 7;
        }),
        aggregate: jest.fn(async () => ({
          _count: { _all: 4 },
          _sum: { total: 480_000 },
        })),
      },
      pos_order: { count: jest.fn(async () => 0) },
      pos_integration: { findUnique: jest.fn(async () => integration) },
    };
    app = await createHttpApp(
      {
        controllers: [StaffOrderController],
        providers: [
          OrderBoardService,
          { provide: PrismaService, useValue: prisma },
          { provide: OrderStaffService, useValue: {} },
          {
            provide: OrderSettingsService,
            useValue: {
              get: async () => ({
                acceptanceTimeoutSeconds: 300,
                pickupReminderMinutes: 5,
                onTheWayAlertMinutes: 60,
                doorWaitMinutes: 10,
                trackPreparation,
              }),
            },
          },
        ],
      },
      [
        { id: 'owner', role: 'owner', organization: { id: ORG } },
        { id: 'operator', role: 'operator', organization: { id: ORG } },
      ],
    );
  });
  afterAll(() => app.close());

  beforeEach(() => {
    jest.useFakeTimers({ now, doNotFake: ['nextTick', 'setImmediate'] });
    findMany.mockClear();
    rows = [];
    trackPreparation = false;
    integration = null;
  });
  afterEach(() => jest.useRealTimers());

  const get = (query = '', who = 'operator') =>
    request(app.getHttpServer())
      .get(`/order/board${query}`)
      .set('Authorization', `Bearer ${staffToken(who)}`);

  it('the operator sees live orders, light, sorted by time in the status', async () => {
    rows = [
      row({
        id: 'o-late',
        number: 1002,
        status: 'pending_acceptance',
        created_at: ago(9),
        events: [
          // online: waited for the payment first
          {
            from_status: 'awaiting_payment',
            to_status: 'pending_acceptance',
            created_at: ago(2),
          },
          {
            from_status: null,
            to_status: 'awaiting_payment',
            created_at: ago(9),
          },
        ],
        items: [1, 2, 3, 4, 5].map((i) => ({
          name: `dish ${i}`,
          quantity: 1,
          position: i,
        })),
      }),
      row({
        events: [
          {
            from_status: 'pending_acceptance',
            to_status: 'accepted',
            created_at: ago(15),
          },
        ],
      }),
    ];
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.serverTime).toBe(now.toISOString());
    expect(res.body.items.map((o: { id: string }) => o.id)).toEqual([
      'o-1',
      'o-late',
    ]);
    expect(res.body.items[0]).toEqual({
      id: 'o-1',
      number: 1001,
      status: 'accepted',
      fulfillmentMode: 'delivery',
      createdAt: ago(20).toISOString(),
      statusSince: ago(15).toISOString(),
      acceptDeadlineAt: null,
      shortAddress: 'Amir Temur 15',
      itemsCount: 2,
      itemsPreview: [{ name: 'Плов', quantity: 2 }],
      total: 125_000,
      currency: 'UZS',
      paymentMethod: 'cash',
      cashChangeFrom: 200_000,
      courier: null,
      posControlled: false,
      courierMode: 'xmenu',
      queuePosition: null,
      attention: ['no_courier'],
      version: 2,
    });
    expect(res.body.items[1]).toMatchObject({
      statusSince: ago(2).toISOString(),
      acceptDeadlineAt: new Date(ago(2).getTime() + 300_000).toISOString(),
      itemsCount: 5,
    });
    expect(res.body.items[1].itemsPreview).toHaveLength(4);
    expect(res.body.thresholds).toEqual({
      pickupReminderMinutes: 5,
      onTheWayAlertMinutes: 60,
      doorWaitMinutes: 10,
      acceptanceTimeoutSeconds: 300,
      posFailed: 0,
      posReconnect: false,
      posCouriers: false,
    });
    expect(res.body.today).toEqual({
      ordersCount: 7,
      completedCount: 4,
      revenue: 480_000,
    });
    expect(res.body.completedTodayCount).toBe(4);

    // Nothing about the guest, no history
    const body = JSON.stringify(res.body);
    for (const leak of ['+998901112233', 'Aziza', 'secret comment', 'домофон'])
      expect(body).not.toContain(leak);
    for (const key of ['phone', 'customer', 'events', 'comment', 'address'])
      expect(res.body.items[0]).not.toHaveProperty(key);
  });

  it('asks for live statuses of this venue only; the day starts at midnight in Tashkent', async () => {
    await get().expect(200);
    expect(findMany.mock.calls[0][0].where).toEqual({
      organization_id: ORG,
      status: {
        in: [
          'pending_acceptance',
          'accepted',
          'preparing',
          'on_the_way',
          'ready',
          'problem_at_door',
        ],
      },
    });
    expect(placedWhere).toEqual({
      organization_id: ORG,
      placed_at: { gte: new Date('2026-11-23T19:00:00.000Z') },
    });
  });

  it('the kitchen queue: trackPreparation in the answer, accepted orders numbered by acceptance time', async () => {
    trackPreparation = true;
    rows = [
      row({ id: 'second', number: 1002, accepted_at: ago(5) }),
      row({ id: 'first', number: 1001, accepted_at: ago(9) }),
      row({
        id: 'cooking',
        number: 1003,
        status: 'preparing',
        accepted_at: ago(12),
      }),
    ];
    const res = await get().expect(200);
    expect(res.body.trackPreparation).toBe(true);
    const position = (id: string) =>
      res.body.items.find((o: { id: string }) => o.id === id).queuePosition;
    expect([
      position('first'),
      position('second'),
      position('cooking'),
    ]).toEqual([1, 2, null]);
    // A delivery preparing without a courier still waits for one
    expect(
      res.body.items.find((o: { id: string }) => o.id === 'cooking').attention,
    ).toEqual(['no_courier']);
  });

  it('iiko connected: the queue is on, an order that reached iiko is led by it, couriers in iiko', async () => {
    integration = { status: 'active', courier_mode: 'iiko' };
    rows = [
      row({ id: 'sent', pos_order: { state: 'sent' } }),
      row({ id: 'stuck', number: 1002, pos_order: { state: 'failed' } }),
      row({ id: 'manual', number: 1003, pos_order: { state: 'manual' } }),
    ];
    const res = await get().expect(200);
    expect(res.body.trackPreparation).toBe(true);
    const item = (id: string) =>
      res.body.items.find((o: { id: string }) => o.id === id);
    expect([
      item('sent').posControlled,
      item('stuck').posControlled,
      item('manual').posControlled,
    ]).toEqual([true, false, false]);
    expect(item('sent').courierMode).toBe('pos');
    expect(item('stuck').attention).toEqual(['pos_needs_action']);
  });

  it('a branch of this venue narrows the board', async () => {
    await get(`?branchId=${BRANCH}`, 'owner').expect(200);
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      organization_id: ORG,
      branch_id: BRANCH,
    });
  });

  it('another venue’s branch looks missing: 404', async () => {
    const res = await get(`?branchId=${FOREIGN_BRANCH}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('a malformed branch id is 400', async () => {
    expect((await get('?branchId=main')).status).toBe(400);
  });

  it('without a token: 401', async () => {
    await request(app.getHttpServer()).get('/order/board').expect(401);
  });
});
