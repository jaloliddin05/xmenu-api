import { Logger } from '@nestjs/common';
import { setup, type Ctx } from 'src/modules/courier/courier-setup.fake';
import { OrderStaffService } from './order-staff.service';
import { POS_OVERRIDE_NOTE } from './order-transition.service';

/**
 * The kitchen steps of the operator (order/domain/kitchen.ts) on the real OrderTransitionService and the in-memory
 * Prisma fake: the venue's kitchen queue for deliveries, turning it on and off with live orders, and orders iiko leads
 * (docs/IIKO.md, "Путь заказа и статусы").
 */
const STAFF = 'user-operator';

let s: Ctx;
let staff: OrderStaffService;

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

beforeEach(async () => {
  s = await setup();
  staff = new OrderStaffService(s.db as any, s.transitions, {
    get: async () => s.orderSettings,
  } as any);
});

const journal = (orderId: string) =>
  s.db.order_status_event.rows
    .filter((e) => e.order_id === orderId)
    .map((e) => `${e.from_status}→${e.to_status}${e.note ? `:${e.note}` : ''}`);

const next = (orderId: string, expected?: string, override = false) =>
  staff.perform(
    s.venue.org.id,
    orderId,
    { type: 'next' },
    STAFF,
    expected as any,
    override,
  );

/** act() answers with GET /order/:id, which the fake cannot build: only its refusals are read here. */
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code: string; details?: { status?: string } };
  }
};

describe('delivery without the kitchen queue (default)', () => {
  it('"next" from accepted is ready; preparing is refused', async () => {
    const order = await s.venue.order();
    expect(await next(order.id, 'accepted')).toMatchObject({
      changed: true,
      status: 'ready',
    });
    expect(journal(order.id)).toEqual(['accepted→ready']);

    const other = await s.venue.order();
    expect(
      await refusal(
        staff.act(
          s.venue.org.id,
          other.id,
          { type: 'set', status: 'preparing' },
          STAFF,
        ),
      ),
    ).toMatchObject({ code: 'order_status_conflict' });
  });
});

describe('delivery with the kitchen queue', () => {
  beforeEach(() => {
    s.orderSettings.trackPreparation = true;
  });

  it('accepted → preparing → ready, one "next" at a time', async () => {
    const order = await s.venue.order();
    expect(await next(order.id, 'accepted')).toMatchObject({
      status: 'preparing',
    });
    expect(await next(order.id, 'preparing')).toMatchObject({
      status: 'ready',
    });
    expect(journal(order.id)).toEqual([
      'accepted→preparing',
      'preparing→ready',
    ]);
  });

  it('straight from accepted to ready is refused', async () => {
    const order = await s.venue.order();
    expect(
      await refusal(
        staff.act(
          s.venue.org.id,
          order.id,
          { type: 'set', status: 'ready' },
          STAFF,
          'accepted',
        ),
      ),
    ).toMatchObject({
      code: 'order_status_conflict',
      details: { status: 'accepted' },
    });
    expect(journal(order.id)).toEqual([]);
  });

  it('a courier can be assigned while the order is preparing', async () => {
    const courier = await s.onShift();
    const order = await s.venue.order({ status: 'preparing' });
    await s.assignments.assign(s.venue.org.id, order.id, courier.id, STAFF);
    expect(s.order(order.id).courier_id).toBe(courier.id);
  });
});

describe('turning the kitchen queue on and off with live orders', () => {
  it('turned off: an order already preparing still gets to ready', async () => {
    s.orderSettings.trackPreparation = true;
    const order = await s.venue.order();
    await next(order.id, 'accepted');
    s.orderSettings.trackPreparation = false;
    expect(await next(order.id, 'preparing')).toMatchObject({
      changed: true,
      status: 'ready',
    });
  });

  it('turned on: an order accepted before goes through preparing', async () => {
    const order = await s.venue.order();
    s.orderSettings.trackPreparation = true;
    expect(await next(order.id, 'accepted')).toMatchObject({
      status: 'preparing',
    });
  });
});

describe('an order iiko leads', () => {
  async function iikoOrder(
    state = 'sent',
    extra: Record<string, unknown> = {},
  ) {
    const integration = await s.db.pos_integration.create({
      data: {
        organization_id: s.venue.org.id,
        status: 'active',
        courier_mode: 'xmenu',
      },
    });
    const order = await s.venue.order({
      phone: '+998901112233',
      address_snapshot: { address: 'Amir Temur 15' },
      ...extra,
    });
    await s.db.pos_order.create({
      data: { order_id: order.id, integration_id: integration.id, state },
    });
    return order;
  }

  it('the kitchen steps of the operator are refused with pos_status_managed', async () => {
    const order = await iikoOrder();
    for (const p of [
      staff.act(s.venue.org.id, order.id, { type: 'next' }, STAFF, 'accepted'),
      staff.act(
        s.venue.org.id,
        order.id,
        { type: 'set', status: 'ready' },
        STAFF,
        'accepted',
      ),
    ])
      expect(await refusal(p)).toMatchObject({
        code: 'pos_status_managed',
        details: { status: 'accepted' },
      });
    expect(journal(order.id)).toEqual([]);
    expect(s.ops.alert).not.toHaveBeenCalled();
  });

  it('with the override the step goes through, the journal and the ops chat say so (no guest data)', async () => {
    const order = await iikoOrder();
    const res = await staff.perform(
      s.venue.org.id,
      order.id,
      { type: 'set', status: 'ready' },
      STAFF,
      'accepted',
      true,
    );
    expect(res).toMatchObject({ changed: true, status: 'ready' });
    expect(journal(order.id)).toEqual([`accepted→ready:${POS_OVERRIDE_NOTE}`]);
    await s.flush();
    expect(s.ops.alert).toHaveBeenCalledTimes(1);
    const line = s.ops.alert.mock.calls[0][0];
    expect(line).toContain(`#${order.number}`);
    expect(line).toContain('Mant');
    expect(line).not.toContain('+998901112233');
    expect(line).not.toContain('Amir Temur');
  });

  it('a pickup "ready" from accepted with the override: both steps marked', async () => {
    const order = await iikoOrder('sent', { fulfillment: 'pickup' });
    await staff.perform(
      s.venue.org.id,
      order.id,
      { type: 'set', status: 'ready' },
      STAFF,
      'accepted',
      true,
    );
    expect(journal(order.id)).toEqual([
      `accepted→preparing:${POS_OVERRIDE_NOTE}`,
      `preparing→ready:${POS_OVERRIDE_NOTE}`,
    ]);
  });

  it('a transfer that is stuck (pos_needs_action) or entered by hand: the operator works as usual', async () => {
    for (const state of ['failed', 'needs_street', 'manual']) {
      const order = await iikoOrder(state);
      // iiko connected: the kitchen queue is on, so "next" goes to preparing
      expect(await next(order.id, 'accepted')).toMatchObject({
        changed: true,
        status: 'preparing',
      });
      expect(journal(order.id)).toEqual(['accepted→preparing']);
      s.db.pos_integration.rows.length = 0;
    }
  });

  it('accept, cancel and the decisions at the door are not the kitchen: unchanged', async () => {
    const order = await iikoOrder();
    expect(
      await staff.perform(
        s.venue.org.id,
        order.id,
        { type: 'reject', reason: 'out_of_stock' },
        STAFF,
        'accepted',
      ),
    ).toMatchObject({ changed: true, status: 'cancelled' });
  });

  it('a Telegram button of an iiko order: "already handled", nothing moves', async () => {
    const order = await iikoOrder();
    expect(await next(order.id, 'accepted')).toEqual({
      changed: false,
      status: 'accepted',
      conflict: true,
      posControlled: true,
    });
  });

  it('iiko itself moves the order (actor pos), no override needed', async () => {
    const order = await iikoOrder();
    await s.transitions.transition({
      orderId: order.id,
      to: 'preparing',
      actor: 'pos',
      note: 'iiko:CookingStarted',
    });
    expect(s.order(order.id).status).toBe('preparing');
  });
});
