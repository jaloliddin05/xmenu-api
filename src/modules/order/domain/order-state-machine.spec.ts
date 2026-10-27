import {
  ORDER_STATUSES,
  checkTransition,
  nextRestaurantStatus,
  OrderActorName,
  OrderStatusName,
} from './order-state-machine';

const ok = (from: OrderStatusName, to: OrderStatusName, actor: OrderActorName, f: 'delivery' | 'pickup' = 'delivery') =>
  checkTransition(from, to, actor, f).ok;

describe('order state machine', () => {
  it('happy path for a delivery order', () => {
    expect(ok('awaiting_payment', 'pending_acceptance', 'payment')).toBe(true);
    expect(ok('pending_acceptance', 'accepted', 'restaurant')).toBe(true);
    expect(ok('accepted', 'preparing', 'restaurant')).toBe(true);
    expect(ok('preparing', 'on_the_way', 'restaurant', 'delivery')).toBe(true);
    expect(ok('on_the_way', 'completed', 'restaurant')).toBe(true);
  });

  it('pickup goes through "ready", delivery through "on_the_way" — never the other way', () => {
    expect(ok('preparing', 'ready', 'restaurant', 'pickup')).toBe(true);
    expect(ok('preparing', 'ready', 'restaurant', 'delivery')).toBe(false);
    expect(ok('preparing', 'on_the_way', 'restaurant', 'pickup')).toBe(false);
    expect(checkTransition('preparing', 'ready', 'restaurant', 'delivery')).toEqual({ ok: false, reason: 'wrong_fulfillment' });
  });

  it('only a payment event can make an order "paid", never the customer', () => {
    expect(ok('awaiting_payment', 'pending_acceptance', 'customer')).toBe(false);
    expect(ok('awaiting_payment', 'pending_acceptance', 'restaurant')).toBe(false);
    expect(ok('awaiting_payment', 'pending_acceptance', 'system')).toBe(false);
  });

  it('only the restaurant moves the kitchen forward', () => {
    for (const actor of ['customer', 'system', 'payment'] as const) {
      expect(ok('pending_acceptance', 'accepted', actor)).toBe(false);
      expect(ok('accepted', 'preparing', actor)).toBe(false);
    }
  });

  it('customer can cancel only until the kitchen starts', () => {
    for (const from of ['awaiting_payment', 'payment_failed', 'pending_acceptance', 'accepted'] as const) {
      expect(ok(from, 'cancelled', 'customer')).toBe(true);
    }
    for (const from of ['preparing', 'on_the_way', 'ready'] as const) {
      expect(ok(from, 'cancelled', 'customer')).toBe(false);
      expect(ok(from, 'cancelled', 'restaurant')).toBe(true);
    }
  });

  it('the system may auto-cancel unaccepted/unpaid orders but not one being cooked', () => {
    expect(ok('pending_acceptance', 'cancelled', 'system')).toBe(true);
    expect(ok('awaiting_payment', 'cancelled', 'system')).toBe(true);
    expect(ok('accepted', 'cancelled', 'system')).toBe(false);
    expect(ok('preparing', 'cancelled', 'system')).toBe(false);
  });

  it('the payment provider may cancel only while the kitchen has not started (a refund it initiated)', () => {
    expect(ok('pending_acceptance', 'cancelled', 'payment')).toBe(true);
    expect(ok('accepted', 'cancelled', 'payment')).toBe(true);
    expect(ok('preparing', 'cancelled', 'payment')).toBe(false);
  });

  it('a failed payment can be retried by the customer only', () => {
    expect(ok('payment_failed', 'awaiting_payment', 'customer')).toBe(true);
    expect(ok('payment_failed', 'awaiting_payment', 'restaurant')).toBe(false);
    expect(ok('awaiting_payment', 'payment_failed', 'payment')).toBe(true);
    expect(ok('awaiting_payment', 'payment_failed', 'system')).toBe(true);
  });

  it('final states have no way out', () => {
    for (const to of ORDER_STATUSES) {
      for (const actor of ['customer', 'restaurant', 'system', 'payment'] as const) {
        expect(checkTransition('completed', to, actor, 'delivery').ok).toBe(false);
        expect(checkTransition('cancelled', to, actor, 'delivery').ok).toBe(false);
      }
    }
    expect(checkTransition('cancelled', 'accepted', 'restaurant', 'delivery')).toEqual({ ok: false, reason: 'final' });
  });

  it('no skipping: awaiting_payment cannot jump straight to preparing', () => {
    expect(ok('pending_acceptance', 'preparing', 'restaurant')).toBe(false);
    expect(ok('accepted', 'completed', 'restaurant')).toBe(false);
  });

  it('nextRestaurantStatus follows the fulfillment type', () => {
    expect(nextRestaurantStatus('pending_acceptance', 'delivery')).toBe('accepted');
    expect(nextRestaurantStatus('preparing', 'delivery')).toBe('on_the_way');
    expect(nextRestaurantStatus('preparing', 'pickup')).toBe('ready');
    expect(nextRestaurantStatus('ready', 'pickup')).toBe('completed');
    expect(nextRestaurantStatus('completed', 'pickup')).toBeNull();
    expect(nextRestaurantStatus('awaiting_payment', 'pickup')).toBeNull();
  });
});
