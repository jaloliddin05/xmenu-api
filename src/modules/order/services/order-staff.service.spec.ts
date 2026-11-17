import { OrderStaffService } from './order-staff.service';

const ORG = 'org-1';
const at = new Date('2026-11-16T10:00:00Z');

const event = (actor: string, actorId: string | null, to = 'accepted') => ({
  id: BigInt(1),
  order_id: 'o1',
  from_status: 'pending_acceptance',
  to_status: to,
  actor,
  actor_id: actorId,
  note: null,
  created_at: at,
});

/** The staff view of one delivery order with a history of the given steps. */
const orderRow = (events: ReturnType<typeof event>[]) => ({
  id: 'o1',
  number: 1001,
  organization_id: ORG,
  customer_id: 'guest-1',
  branch_id: 'b1',
  status: 'completed',
  fulfillment: 'delivery',
  version: 5,
  phone: '+998901112233',
  comment: null,
  address_snapshot: null,
  payment_method: 'cash',
  payment_status: 'not_required',
  payment_expires_at: null,
  currency: 'UZS',
  subtotal: 50000,
  delivery_fee: 10000,
  discount: 0,
  total: 60000,
  cash_change_from: null,
  cancelled_by: null,
  cancel_reason: null,
  cancelled_at: null,
  placed_at: at,
  accepted_at: at,
  completed_at: at,
  created_at: at,
  updated_at: at,
  branch: { id: 'b1', title: 'Chilonzor', address: 'Bunyodkor 1' },
  items: [],
  customer: { id: 'guest-1', name: 'Aziza', phone: '+998901112233' },
  courier: { id: 'courier-1', name: 'Aziz', phone: '+998907770000' },
  events,
});

const TIMERS = {
  pickupReminderMinutes: 7,
  onTheWayAlertMinutes: 45,
  doorWaitMinutes: 12,
};

function setup(rows: ReturnType<typeof orderRow>[]) {
  const members = [
    {
      organization_id: ORG,
      user_id: 'user-owner',
      first_name: 'Bekzod',
      last_name: 'Karimov',
      role: 'owner',
    },
    {
      organization_id: ORG,
      user_id: 'user-operator',
      first_name: 'Dilshod',
      last_name: null,
      role: 'operator',
    },
    // a member of another venue with the same user id shape
    {
      organization_id: 'org-2',
      user_id: 'user-foreign',
      first_name: 'Foreign',
      last_name: null,
      role: 'owner',
    },
  ];
  const couriers = [
    { organization_id: ORG, id: 'courier-1', name: 'Aziz' },
    { organization_id: 'org-2', id: 'courier-foreign', name: 'Other' },
  ];
  const inScope = <T extends { organization_id: string }>(
    list: T[],
    where: { organization_id: string },
    key: keyof T,
    ids: string[],
  ) =>
    list.filter(
      (r) =>
        r.organization_id === where.organization_id &&
        ids.includes(r[key] as string),
    );
  const prisma = {
    customer_order: {
      findMany: jest.fn(async () => rows),
      findFirst: jest.fn(async () => rows[0] ?? null),
    },
    organization_member: {
      findMany: jest.fn(async ({ where }) =>
        inScope(members, where, 'user_id', where.user_id.in),
      ),
    },
    courier: {
      findMany: jest.fn(async ({ where }) =>
        inScope(couriers, where, 'id', where.id.in),
      ),
    },
    pos_order: { count: jest.fn(async () => 0) },
    pos_integration: {
      findUnique: jest.fn(
        async (): Promise<{ status: string; courier_mode: string } | null> =>
          null,
      ),
    },
  };
  const service = new OrderStaffService(
    prisma as any,
    {} as any,
    { get: async () => TIMERS } as any,
  );
  return { service, prisma };
}

describe('OrderStaffService: who did each step (W13-13)', () => {
  it('names the owner, the operator and the courier; the guest, the system and foreign ids stay unnamed', async () => {
    const { service } = setup([
      orderRow([
        event('customer', 'guest-1', 'pending_acceptance'),
        event('restaurant', 'user-operator'),
        event('restaurant', 'user-owner', 'ready'),
        event('courier', 'courier-1', 'on_the_way'),
        event('system', null, 'ready'),
        event('restaurant', 'user-foreign', 'cancelled'),
        event('courier', 'courier-foreign', 'completed'),
      ]),
    ]);
    const view = await service.get(ORG, 'o1');
    expect(view.events.map((e) => [e.actor, e.actorName, e.actorRole])).toEqual(
      [
        ['customer', null, null],
        ['restaurant', 'Dilshod', 'operator'],
        ['restaurant', 'Bekzod Karimov', 'owner'],
        ['courier', 'Aziz', null],
        ['system', null, null],
        ['restaurant', null, null],
        ['courier', null, null],
      ],
    );
  });

  it('the list reads the names once for the whole page', async () => {
    const { service, prisma } = setup([
      orderRow([event('restaurant', 'user-operator')]),
      orderRow([event('restaurant', 'user-owner')]),
    ]);
    const list = await service.list(ORG, {});
    expect(list.items.map((o) => o.events[0].actorName)).toEqual([
      'Dilshod',
      'Bekzod Karimov',
    ]);
    expect(prisma.organization_member.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.courier.findMany).not.toHaveBeenCalled();
  });
});

describe('OrderStaffService: reminder thresholds in the list (W13-06)', () => {
  it('carries the venue timers, and nothing else of the settings', async () => {
    const { service } = setup([]);
    const list = await service.list(ORG, {});
    expect(list.reminders).toEqual({
      ...TIMERS,
      posFailed: 0,
      posReconnect: false,
      posCouriers: false,
    });
  });
});

describe('OrderStaffService: iiko in the list (docs/IIKO.md, "Ошибки и сбои")', () => {
  it('orders to act on, a key to reconnect and couriers in iiko; the filter by transfer state', async () => {
    const { service, prisma } = setup([]);
    prisma.pos_order.count.mockResolvedValue(2);
    prisma.pos_integration.findUnique.mockResolvedValue({
      status: 'needs_reconnect',
      courier_mode: 'iiko',
    });
    const list = await service.list(ORG, {
      posStates: ['failed', 'needs_street'],
    });
    expect(list.reminders).toMatchObject({
      posFailed: 2,
      posReconnect: true,
      posCouriers: true,
    });
    expect(prisma.pos_order.count).toHaveBeenCalledWith({
      where: {
        state: { in: ['failed', 'needs_street'] },
        order: {
          organization_id: ORG,
          status: { in: expect.arrayContaining(['accepted', 'ready']) },
        },
      },
    });
    expect(prisma.customer_order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pos_order: { state: { in: ['failed', 'needs_street'] } },
        }),
      }),
    );
  });

  it('a draft integration: couriers stay in Xmenu', async () => {
    const { service, prisma } = setup([]);
    prisma.pos_integration.findUnique.mockResolvedValue({
      status: 'draft',
      courier_mode: 'iiko',
    });
    const list = await service.list(ORG, {});
    expect(list.reminders.posCouriers).toBe(false);
  });
});
