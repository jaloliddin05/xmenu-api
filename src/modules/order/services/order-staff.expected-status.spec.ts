import { Logger } from '@nestjs/common';
import { setup, type Ctx } from 'src/modules/courier/courier-setup.fake';
import { mergeStepEffects } from './order-transition.service';
import { OrderStaffService } from './order-staff.service';

/**
 * Operator actions with the status the operator saw (the board, docs/API.md, "Доска заказов"), the pickup chain
 * accepted → preparing → ready in one request, and the web push effects of the transitions. Real
 * OrderTransitionService on the in-memory Prisma fake.
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
    .map((e) => `${e.from_status}→${e.to_status}`);

/** act() answers with GET /order/:id, which the fake cannot build: only its conflicts are checked here. */
const conflictOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code: string; details?: { status?: string } };
  }
};

describe('expectedStatus', () => {
  it('two operators accept the same order at once: one moves it, the other gets 409', async () => {
    const order = await s.venue.order({ status: 'pending_acceptance' });
    const accept = () =>
      conflictOf(
        staff.act(
          s.venue.org.id,
          order.id,
          { type: 'accept' },
          STAFF,
          'pending_acceptance',
        ),
      );
    const results = await Promise.all([accept(), accept()]);

    expect(s.order(order.id).status).toBe('accepted');
    expect(journal(order.id)).toEqual(['pending_acceptance→accepted']);
    // The winner fails only at reading the view (fake); the loser fails with the conflict
    const conflicts = results.filter(
      (r) => r?.code === 'order_status_conflict',
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.details).toEqual({ status: 'accepted' });
  });

  it('an order already in another status: 409 with the current status, nothing moves', async () => {
    const order = await s.venue.order({ status: 'accepted' });
    const err = await conflictOf(
      staff.act(
        s.venue.org.id,
        order.id,
        { type: 'accept' },
        STAFF,
        'pending_acceptance',
      ),
    );
    expect(err).toMatchObject({
      code: 'order_status_conflict',
      details: { status: 'accepted' },
    });
    expect(journal(order.id)).toEqual([]);
  });

  it('"ready" dragged from the column the order already left: 409', async () => {
    const order = await s.venue.order({ status: 'on_the_way' });
    const err = await conflictOf(
      staff.act(s.venue.org.id, order.id, { type: 'next' }, STAFF, 'accepted'),
    );
    expect(err).toMatchObject({ details: { status: 'on_the_way' } });
    expect(s.order(order.id).status).toBe('on_the_way');
  });

  it('without expectedStatus a repeated accept stays a quiet repeat (old dashboard, bot)', async () => {
    const order = await s.venue.order({ status: 'pending_acceptance' });
    const first = await staff.perform(
      s.venue.org.id,
      order.id,
      { type: 'accept' },
      STAFF,
    );
    const again = await staff.perform(
      s.venue.org.id,
      order.id,
      { type: 'accept' },
      STAFF,
    );
    expect(first).toEqual({
      changed: true,
      status: 'accepted',
      conflict: false,
    });
    expect(again).toEqual({
      changed: false,
      status: 'accepted',
      conflict: false,
    });
  });

  it('another venue’s order is 404 whatever the expected status', async () => {
    const order = await s.venue.order({ status: 'pending_acceptance' });
    await expect(
      staff.act(
        'org-other',
        order.id,
        { type: 'accept' },
        STAFF,
        'pending_acceptance',
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('pickup: ready straight from accepted', () => {
  it('passes preparing in one transaction, writes both steps, the guest hears one change', async () => {
    const order = await s.venue.order({
      status: 'accepted',
      fulfillment: 'pickup',
    });
    const dispatch = jest.spyOn(s.transitions, 'dispatchEffects');
    const res = await staff.perform(
      s.venue.org.id,
      order.id,
      { type: 'set', status: 'ready' },
      STAFF,
      'accepted',
    );

    expect(res).toEqual({ changed: true, status: 'ready', conflict: false });
    expect(s.order(order.id)).toMatchObject({ status: 'ready', version: 2 });
    expect(journal(order.id)).toEqual([
      'accepted→preparing',
      'preparing→ready',
    ]);
    const effects = dispatch.mock.calls[0][1];
    expect(effects.filter((e) => e.type === 'status_changed')).toEqual([
      { type: 'status_changed', from: 'accepted', to: 'ready' },
    ]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('works without expectedStatus too (from the status read)', async () => {
    const order = await s.venue.order({
      status: 'accepted',
      fulfillment: 'pickup',
    });
    await staff.perform(
      s.venue.org.id,
      order.id,
      { type: 'set', status: 'ready' },
      STAFF,
    );
    expect(s.order(order.id).status).toBe('ready');
  });

  it('a pickup already preparing takes the one step', async () => {
    const order = await s.venue.order({
      status: 'preparing',
      fulfillment: 'pickup',
    });
    await staff.perform(
      s.venue.org.id,
      order.id,
      { type: 'set', status: 'ready' },
      STAFF,
      'preparing',
    );
    expect(journal(order.id)).toEqual(['preparing→ready']);
  });

  it('a delivery is not chained: accepted → ready is its own single step', async () => {
    const order = await s.venue.order({ status: 'accepted' });
    await staff.perform(
      s.venue.org.id,
      order.id,
      { type: 'set', status: 'ready' },
      STAFF,
      'accepted',
    );
    expect(journal(order.id)).toEqual(['accepted→ready']);
  });

  it('the chain refuses an order that left accepted', async () => {
    const order = await s.venue.order({
      status: 'preparing',
      fulfillment: 'pickup',
    });
    const err = await conflictOf(
      staff.act(
        s.venue.org.id,
        order.id,
        { type: 'set', status: 'ready' },
        STAFF,
        'accepted',
      ),
    );
    expect(err).toMatchObject({ details: { status: 'preparing' } });
    expect(journal(order.id)).toEqual([]);
  });
});

describe('mergeStepEffects', () => {
  it('one step comes back as is', () => {
    const effects = [
      { type: 'status_changed', from: 'accepted', to: 'ready' } as const,
      { type: 'delivery_timers' } as const,
    ];
    expect(mergeStepEffects(effects, 'accepted', 'ready')).toEqual(effects);
  });

  it('two steps: one status change from the first to the last, the rest once', () => {
    expect(
      mergeStepEffects(
        [
          { type: 'status_changed', from: 'accepted', to: 'preparing' },
          { type: 'courier_card', courierId: 'c1' },
          { type: 'status_changed', from: 'preparing', to: 'ready' },
          { type: 'courier_card', courierId: 'c1' },
        ],
        'accepted',
        'ready',
      ),
    ).toEqual([
      { type: 'status_changed', from: 'accepted', to: 'ready' },
      { type: 'courier_card', courierId: 'c1' },
    ]);
  });
});

describe('web push effects of transitions', () => {
  it('the courier cannot deliver: push cannot_deliver; the system taking a disabled courier off: none', async () => {
    const courier = await s.venue.courier();
    const byCourier = await s.venue.order({
      status: 'on_the_way',
      courier_id: courier.id,
    });
    await s.transitions.transition({
      orderId: byCourier.id,
      to: 'ready',
      actor: 'courier',
      actorId: courier.id,
    });
    const bySystem = await s.venue.order({
      status: 'on_the_way',
      courier_id: courier.id,
    });
    await s.transitions.transition({
      orderId: bySystem.id,
      to: 'ready',
      actor: 'system',
    });
    await s.flush();

    expect(s.staffPush.notify).toHaveBeenCalledTimes(1);
    expect(s.staffPush.notify).toHaveBeenCalledWith(
      byCourier.id,
      'cannot_deliver',
      1,
    );
  });

  it('a problem at the door: push at_door with the version of that transition', async () => {
    const courier = await s.venue.courier();
    const order = await s.venue.order({
      status: 'on_the_way',
      courier_id: courier.id,
      version: 4,
    });
    await s.transitions.transition({
      orderId: order.id,
      to: 'problem_at_door',
      actor: 'courier',
      actorId: courier.id,
      doorProblem: { kind: 'no_answer' },
    });
    await s.flush();
    expect(s.staffPush.notify).toHaveBeenCalledWith(order.id, 'at_door', 5);
  });

  it('a new order (the placed effect): push new_order', async () => {
    const order = await s.venue.order({ status: 'pending_acceptance' });
    await s.transitions.runEffects(s.order(order.id) as any, [
      { type: 'placed' },
    ]);
    expect(s.staffPush.notify).toHaveBeenCalledWith(order.id, 'new_order', 0);
  });

  it('other transitions send nothing', async () => {
    const order = await s.venue.order({ status: 'pending_acceptance' });
    await staff.perform(s.venue.org.id, order.id, { type: 'accept' }, STAFF);
    await s.flush();
    expect(s.staffPush.notify).not.toHaveBeenCalled();
  });
});
