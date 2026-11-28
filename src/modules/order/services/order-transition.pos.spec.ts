import { OrderTransitionService } from './order-transition.service';

/**
 * The POS hooks of the transition (docs/IIKO.md, "Путь заказа и статусы", "Курьеры"): an accepted
 * order of a linked branch gets its pos_order row in the same transaction and a push job; an own
 * courier's "delivered" queues the statuses for iiko; cancelling an order iiko has alerts the operator.
 */
function setup(order: Record<string, unknown>) {
  const row: Record<string, any> = {
    id: 'o1',
    organization_id: 'org',
    branch_id: 'b1',
    status: 'pending_acceptance',
    fulfillment: 'delivery',
    version: 0,
    courier_id: null,
    payment_status: 'not_required',
    payment_method: 'cash',
    placed_at: new Date(),
    ...order,
  };
  const tx = {
    customer_order: {
      findUnique: jest.fn(async () => ({ ...row })),
      findUniqueOrThrow: jest.fn(async () => ({ ...row })),
      updateMany: jest.fn(async ({ data }: any) => {
        Object.assign(row, { status: data.status });
        return { count: 1 };
      }),
    },
    order_status_event: { create: jest.fn(async () => undefined) },
    pos_branch_link: {
      findUnique: jest.fn(
        async (): Promise<Record<string, unknown> | null> => null,
      ),
    },
    pos_order: {
      upsert: jest.fn(async () => undefined),
      updateMany: jest.fn(async () => ({ count: 0 })),
      count: jest.fn(async () => 0),
    },
    courier: { findUnique: jest.fn(async () => null) },
    branch: { findUnique: jest.fn(async () => null) },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const queues = {
    enqueuePosOrder: jest.fn(async () => undefined),
    resetDeliveryTimers: jest.fn(async () => undefined),
    enqueueCourierCard: jest.fn(async () => undefined),
  };
  const restaurant = {
    alertPos: jest.fn(async () => undefined),
    refreshMessage: jest.fn(async () => undefined),
  };
  const settings = {
    get: jest.fn(async () => ({ courierPay: null })),
  };
  const service = new OrderTransitionService(
    prisma as any,
    settings as any,
    restaurant as any,
    { notifyStatus: jest.fn(async () => undefined) } as any,
    queues as any,
    { notify: jest.fn(async () => undefined) } as any,
    { alert: jest.fn(async () => undefined) } as any,
  );
  return { service, tx, queues, restaurant };
}

/** The POS effects of a transition */
const effectTypes = (effects: { type: string }[]) =>
  effects.filter((e) => e.type.startsWith('pos'));

describe('OrderTransitionService and the POS', () => {
  it('accepted at a branch linked to an enabled integration: pos_order in the transaction, then a push job', async () => {
    const s = setup({});
    s.tx.pos_branch_link.findUnique.mockResolvedValue({
      integration_id: 'int',
      integration: { status: 'active' },
    });
    const result = await s.service.transitionInTx(s.tx as any, {
      orderId: 'o1',
      to: 'accepted',
      actor: 'restaurant',
    });
    expect(s.tx.pos_order.upsert).toHaveBeenCalledWith({
      where: { order_id: 'o1' },
      create: { order_id: 'o1', integration_id: 'int' },
      update: {},
    });
    expect(effectTypes(result.effects)).toEqual([
      { type: 'pos_job', name: 'push' },
    ]);
    await s.service.runEffects(result.order, result.effects);
    expect(s.queues.enqueuePosOrder).toHaveBeenCalledWith('push', 'o1');
  });

  it.each([
    ['no link', null],
    [
      'a draft integration',
      { integration_id: 'int', integration: { status: 'draft' } },
    ],
  ])('accepted with %s: nothing goes to the POS', async (_label, link) => {
    const s = setup({});
    s.tx.pos_branch_link.findUnique.mockResolvedValue(link);
    const result = await s.service.transitionInTx(s.tx as any, {
      orderId: 'o1',
      to: 'accepted',
      actor: 'restaurant',
    });
    expect(s.tx.pos_order.upsert).not.toHaveBeenCalled();
    expect(effectTypes(result.effects)).toEqual([]);
  });

  it('an own courier delivered an order iiko has: OnWay and Delivered are queued once', async () => {
    const s = setup({ status: 'on_the_way', courier_id: 'c1' });
    s.tx.pos_order.updateMany.mockResolvedValue({ count: 1 });
    const result = await s.service.transitionInTx(s.tx as any, {
      orderId: 'o1',
      to: 'completed',
      actor: 'courier',
      actorId: 'c1',
    });
    expect(s.tx.pos_order.updateMany).toHaveBeenCalledWith({
      where: { order_id: 'o1', state: 'sent', delivered_push: 'none' },
      data: { delivered_push: 'pending' },
    });
    expect(effectTypes(result.effects)).toEqual([
      { type: 'pos_job', name: 'delivered' },
    ]);
  });

  it('delivered by iiko (iiko couriers): nothing is sent back', async () => {
    const s = setup({ status: 'on_the_way' });
    const result = await s.service.transitionInTx(s.tx as any, {
      orderId: 'o1',
      to: 'completed',
      actor: 'pos',
    });
    expect(s.tx.pos_order.updateMany).not.toHaveBeenCalled();
    expect(effectTypes(result.effects)).toEqual([]);
  });

  it('the operator cancels an order iiko has: an alert to cancel it there too', async () => {
    const s = setup({ status: 'accepted' });
    s.tx.pos_order.count.mockResolvedValue(1);
    const result = await s.service.transitionInTx(s.tx as any, {
      orderId: 'o1',
      to: 'cancelled',
      actor: 'restaurant',
    });
    expect(effectTypes(result.effects)).toEqual([
      { type: 'pos_alert', alert: { kind: 'cancel_in_pos' } },
    ]);
    await s.service.runEffects(result.order, result.effects);
    expect(s.restaurant.alertPos).toHaveBeenCalledWith('o1', {
      kind: 'cancel_in_pos',
    });
  });

  it('iiko cancelled it: no alert to cancel it in iiko', async () => {
    const s = setup({ status: 'accepted' });
    s.tx.pos_order.count.mockResolvedValue(1);
    const result = await s.service.transitionInTx(s.tx as any, {
      orderId: 'o1',
      to: 'cancelled',
      actor: 'pos',
      reason: 'pos_cancelled',
    });
    expect(effectTypes(result.effects)).toEqual([]);
  });
});
