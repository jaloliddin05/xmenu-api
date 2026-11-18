import { InvalidTransitionError } from 'src/modules/order/services/order-transition.service';
import type { PosDeliveryStatus, PosOrderInfo } from '../provider/pos-provider';
import { fakePosOrderWorld, INTEGRATION, ORDER } from './pos-order.fake';
import { PosOrderStatusService } from './pos-order-status.service';
import { PosOrderService } from './pos-order.service';

const info = (
  status: PosDeliveryStatus | null,
  over: Partial<PosOrderInfo> = {},
): PosOrderInfo => ({
  id: ORDER,
  creation: 'success',
  errorCode: null,
  status,
  number: '1042',
  courierName: null,
  ...over,
});

describe('PosOrderStatusService', () => {
  let t: ReturnType<typeof fakePosOrderWorld>;
  let orders: PosOrderService;
  let service: PosOrderStatusService;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    env = { ...process.env };
    t = fakePosOrderWorld();
    Object.assign(t.world.pos, { state: 'sent', attempts: 1 });
    orders = new PosOrderService(
      t.prisma as any,
      t.provider as any,
      t.keyring,
      t.transitions as any,
      t.restaurant as any,
      t.queue as any,
      t.alerts as any,
      t.streets as any,
    );
    service = new PosOrderStatusService(
      t.prisma as any,
      t.provider as any,
      t.keyring,
      orders,
      t.transitions as any,
      t.restaurant as any,
    );
  });

  afterEach(() => {
    process.env = env;
  });

  const alerts = () => t.restaurant.alertPos.mock.calls.map((c: any[]) => c[1]);

  it('CookingCompleted: "ready" by actor pos; the same event again changes nothing', async () => {
    await service.apply(INTEGRATION, info('CookingStarted'));
    await service.apply(INTEGRATION, info('CookingCompleted'));
    await service.apply(INTEGRATION, info('CookingCompleted'));
    expect(t.transitions.transition).toHaveBeenCalledTimes(1);
    expect(t.transitions.transition).toHaveBeenCalledWith({
      orderId: ORDER,
      to: 'ready',
      actor: 'pos',
      note: 'iiko:CookingCompleted',
    });
    expect(t.journal).toEqual([
      'iiko:CookingStarted',
      'ready:iiko:CookingCompleted',
    ]);
    expect(t.world.pos.pos_status).toBe('CookingCompleted');
  });

  it('Unconfirmed: confirmed in iiko', async () => {
    await service.apply(INTEGRATION, info('Unconfirmed'));
    expect(t.provider.confirmOrder).toHaveBeenCalledWith(
      expect.anything(),
      'iiko-org',
      ORDER,
    );
    expect(t.transitions.transition).not.toHaveBeenCalled();
  });

  it('iiko couriers: on the way with the courier name, then delivered', async () => {
    t.world.integration.courier_mode = 'iiko';
    t.world.order.status = 'ready';
    await service.apply(INTEGRATION, info('OnWay', { courierName: 'Bekzod' }));
    expect(t.world.order.status).toBe('on_the_way');
    expect(t.world.pos.courier_name).toBe('Bekzod');
    await service.apply(INTEGRATION, info('Delivered'));
    expect(t.world.order.status).toBe('completed');
    // Closed afterwards: already there
    await service.apply(INTEGRATION, info('Closed'));
    expect(t.transitions.transition).toHaveBeenCalledTimes(2);
    expect(t.restaurant.alertPos).not.toHaveBeenCalled();
  });

  it('Xmenu couriers: OnWay and Closed of iiko change nothing', async () => {
    t.world.order.status = 'ready';
    await service.apply(INTEGRATION, info('OnWay'));
    t.world.order.status = 'completed';
    await service.apply(INTEGRATION, info('Closed'));
    expect(t.transitions.transition).not.toHaveBeenCalled();
    expect(t.journal).toEqual(['iiko:OnWay', 'iiko:Closed']);
  });

  it('Cancelled in iiko: cancelled with the reason pos_cancelled and the operator alerted', async () => {
    await service.apply(INTEGRATION, info('Cancelled'));
    expect(t.transitions.transition).toHaveBeenCalledWith({
      orderId: ORDER,
      to: 'cancelled',
      actor: 'pos',
      note: 'iiko:Cancelled',
      reason: 'pos_cancelled',
    });
    expect(alerts()).toEqual([{ kind: 'cancelled' }]);
  });

  it('a status going back: journal and alert, the status and the last iiko status stay', async () => {
    t.world.pos.pos_status = 'CookingCompleted';
    t.world.order.status = 'ready';
    await service.apply(INTEGRATION, info('CookingStarted'));
    expect(t.transitions.transition).not.toHaveBeenCalled();
    expect(t.journal).toEqual(['iiko:CookingStarted:conflict']);
    expect(alerts()).toEqual([
      { kind: 'conflict', posStatus: 'CookingStarted' },
    ]);
    expect(t.world.pos.pos_status).toBe('CookingCompleted');
  });

  it('the transition is refused (the order moved meanwhile): journal and alert', async () => {
    t.transitions.transition.mockRejectedValueOnce(
      new InvalidTransitionError('cancelled', 'ready', 'final'),
    );
    await service.apply(INTEGRATION, info('CookingCompleted'));
    expect(t.journal).toEqual(['iiko:CookingCompleted:conflict']);
    expect(alerts()).toEqual([
      { kind: 'conflict', posStatus: 'CookingCompleted' },
    ]);
  });

  it('another integration, an unknown order, an order entered by hand: ignored', async () => {
    await service.apply('int-2', info('CookingCompleted'));
    await service.apply(INTEGRATION, info('CookingCompleted', { id: 'x' }));
    t.world.pos.state = 'manual';
    await service.apply(INTEGRATION, info('CookingCompleted'));
    expect(t.transitions.transition).not.toHaveBeenCalled();
  });

  it('an order still being sent: the creation result settles it first, then the status counts', async () => {
    Object.assign(t.world.pos, { state: 'sending', correlation_id: 'cid' });
    await service.apply(INTEGRATION, info('CookingCompleted'));
    expect(t.world.pos).toMatchObject({ state: 'sent', pos_number: '1042' });
    expect(t.world.order.status).toBe('ready');
  });

  it('DeliveryOrderError of an order being sent: the failure path (no status)', async () => {
    Object.assign(t.world.pos, { state: 'sending', correlation_id: 'cid' });
    await service.apply(
      INTEGRATION,
      info(null, { creation: 'error', errorCode: 'StopListedProduct' }),
    );
    expect(t.world.pos).toMatchObject({
      state: 'failed',
      error: 'pos_rejected_stop_list',
    });
  });

  it('the poll asks iiko about unfinished orders and applies the same rules', async () => {
    t.provider.orders.mockResolvedValue([info('CookingCompleted')] as never);
    await service.poll(INTEGRATION);
    expect(t.provider.orders).toHaveBeenCalledWith(
      expect.anything(),
      'iiko-org',
      [ORDER],
    );
    expect(t.world.order.status).toBe('ready');
  });

  it('the poll skips a draft integration and survives an iiko failure', async () => {
    t.world.integration.status = 'draft';
    await service.poll(INTEGRATION);
    expect(t.provider.orders).not.toHaveBeenCalled();
    t.world.integration.status = 'active';
    t.provider.orders.mockRejectedValue(new Error('down'));
    await expect(service.poll(INTEGRATION)).resolves.toBeUndefined();
  });
});
