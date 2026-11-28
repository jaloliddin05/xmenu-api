import type { OrderStatusName } from 'src/modules/order/domain/order-state-machine';
import type { PosDeliveryStatus } from '../provider/pos-provider';
import { decidePosStatus, type PosStatusInput } from './pos-status-map';

const decide = (
  status: PosDeliveryStatus,
  orderStatus: OrderStatusName,
  over: Partial<PosStatusInput> = {},
) =>
  decidePosStatus({
    status,
    previous: null,
    order: { status: orderStatus, fulfillment: 'delivery' },
    courierMode: 'xmenu',
    ...over,
  });

const steps = (...args: Parameters<typeof decide>) => decide(...args).steps;

describe('decidePosStatus (docs/IIKO.md, "Путь заказа и статусы")', () => {
  it('Unconfirmed: confirmed at once, the status stays', () => {
    expect(decide('Unconfirmed', 'accepted')).toMatchObject({
      confirm: true,
      steps: [],
      alert: null,
    });
  });

  it.each<PosDeliveryStatus>(['WaitCooking', 'ReadyForCooking', 'Waiting'])(
    '%s: journal only',
    (status) => {
      expect(decide(status, 'accepted')).toEqual({
        repeat: false,
        steps: [],
        cancel: false,
        confirm: false,
        alert: null,
      });
    },
  );

  it('CookingStarted: "preparing" for delivery and pickup, only forward', () => {
    expect(steps('CookingStarted', 'accepted')).toEqual(['preparing']);
    expect(
      steps('CookingStarted', 'accepted', {
        order: { status: 'accepted', fulfillment: 'pickup' },
      }),
    ).toEqual(['preparing']);
    // Already there or further (the operator marked it, or iiko reported ready first): nothing moves
    expect(steps('CookingStarted', 'preparing')).toEqual([]);
    expect(steps('CookingStarted', 'ready')).toEqual([]);
  });

  it('CookingCompleted: "ready" instead of the operator, through "preparing" when it was skipped', () => {
    expect(steps('CookingCompleted', 'accepted')).toEqual([
      'preparing',
      'ready',
    ]);
    expect(steps('CookingCompleted', 'preparing')).toEqual(['ready']);
    expect(
      steps('CookingCompleted', 'accepted', {
        order: { status: 'accepted', fulfillment: 'pickup' },
      }),
    ).toEqual(['preparing', 'ready']);
    expect(
      steps('CookingCompleted', 'preparing', {
        order: { status: 'preparing', fulfillment: 'pickup' },
      }),
    ).toEqual(['ready']);
    // The operator was faster: nothing to move
    expect(steps('CookingCompleted', 'ready')).toEqual([]);
  });

  describe('iiko couriers', () => {
    const iiko = { courierMode: 'iiko' as const };
    it('OnWay → on the way, Delivered → delivered, through the steps missed', () => {
      expect(steps('OnWay', 'ready', iiko)).toEqual(['on_the_way']);
      expect(steps('OnWay', 'accepted', iiko)).toEqual([
        'preparing',
        'ready',
        'on_the_way',
      ]);
      expect(steps('Delivered', 'on_the_way', iiko)).toEqual(['completed']);
      expect(steps('Delivered', 'ready', iiko)).toEqual([
        'on_the_way',
        'completed',
      ]);
    });
    it('Closed completes an order not completed yet, and leaves a completed one', () => {
      expect(steps('Closed', 'on_the_way', iiko)).toEqual(['completed']);
      expect(
        decide('Closed', 'completed', { ...iiko, previous: 'Delivered' }),
      ).toMatchObject({ steps: [], alert: null });
    });
  });

  describe('Xmenu couriers', () => {
    it('OnWay and Delivered come from the courier: journal only', () => {
      expect(steps('OnWay', 'ready')).toEqual([]);
      expect(steps('Delivered', 'on_the_way')).toEqual([]);
    });
    it('Closed stays with the cash desk and changes nothing', () => {
      expect(
        decide('Closed', 'completed', { previous: 'Delivered' }),
      ).toMatchObject({ steps: [], alert: null });
      expect(steps('Closed', 'on_the_way')).toEqual([]);
    });
  });

  it('pickup: Closed is "handed over"', () => {
    expect(
      steps('Closed', 'ready', {
        order: { status: 'ready', fulfillment: 'pickup' },
      }),
    ).toEqual(['completed']);
    expect(
      steps('Closed', 'accepted', {
        order: { status: 'accepted', fulfillment: 'pickup' },
      }),
    ).toEqual(['preparing', 'ready', 'completed']);
  });

  it('Cancelled: the order is cancelled and the operator alerted, in any courier mode', () => {
    for (const courierMode of ['xmenu', 'iiko'] as const)
      for (const status of ['accepted', 'ready', 'on_the_way'] as const)
        expect(decide('Cancelled', status, { courierMode })).toMatchObject({
          cancel: true,
          alert: 'cancelled',
        });
    // Already cancelled in Xmenu: nothing
    expect(decide('Cancelled', 'cancelled')).toMatchObject({
      cancel: false,
      alert: null,
    });
  });

  it('the same status again is a repeat: no journal, no change', () => {
    expect(
      decide('CookingCompleted', 'ready', { previous: 'CookingCompleted' }),
    ).toMatchObject({ repeat: true, steps: [] });
  });

  it('only forward: a status below the last one seen raises an alert and changes nothing', () => {
    expect(
      decide('CookingStarted', 'ready', { previous: 'CookingCompleted' }),
    ).toMatchObject({ steps: [], alert: 'conflict' });
    expect(
      decide('CookingCompleted', 'accepted', { previous: 'Cancelled' }),
    ).toMatchObject({ steps: [], alert: 'conflict' });
  });

  it('a contradiction: progress of an order Xmenu cancelled, iiko cancelling a delivered one', () => {
    expect(decide('CookingCompleted', 'cancelled')).toMatchObject({
      steps: [],
      alert: 'conflict',
    });
    expect(decide('Cancelled', 'completed')).toMatchObject({
      cancel: false,
      alert: 'conflict',
    });
  });

  it('not on the path (a problem at the door): nothing moves', () => {
    expect(
      steps('Delivered', 'problem_at_door', { courierMode: 'iiko' }),
    ).toEqual([]);
  });
});
