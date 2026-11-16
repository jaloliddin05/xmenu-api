import {
  FINAL_STATUSES,
  ORDER_STATUSES,
  checkTransition,
  customerCanCancel,
  nextRestaurantStatus,
  OrderActorName,
  OrderStatusName,
} from './order-state-machine';

const ACTORS: OrderActorName[] = [
  'customer',
  'restaurant',
  'courier',
  'system',
  'payment',
];

const ok = (
  from: OrderStatusName,
  to: OrderStatusName,
  actor: OrderActorName,
  f: 'delivery' | 'pickup' = 'delivery',
) => checkTransition(from, to, actor, f).ok;

/** Every allowed (from, to, actor) of one fulfillment, to compare with the spec table as a whole. */
function allowed(f: 'delivery' | 'pickup'): string[] {
  const out: string[] = [];
  for (const from of ORDER_STATUSES)
    for (const to of ORDER_STATUSES)
      for (const actor of ACTORS)
        if (ok(from, to, actor, f)) out.push(`${from} -> ${to} by ${actor}`);
  return out.sort();
}

const PAYMENT_STEPS = [
  'awaiting_payment -> cancelled by customer',
  'awaiting_payment -> cancelled by system',
  'awaiting_payment -> payment_failed by payment',
  'awaiting_payment -> payment_failed by system',
  'awaiting_payment -> pending_acceptance by payment',
  'payment_failed -> awaiting_payment by customer',
  'payment_failed -> cancelled by customer',
  'payment_failed -> cancelled by system',
  'pending_acceptance -> accepted by restaurant',
  'pending_acceptance -> cancelled by customer',
  'pending_acceptance -> cancelled by payment',
  'pending_acceptance -> cancelled by restaurant',
  'pending_acceptance -> cancelled by system',
];

describe('order state machine', () => {
  it('delivery: exactly the transitions of docs/DELIVERY.md, "Статусы заказа"', () => {
    expect(allowed('delivery')).toEqual(
      [
        ...PAYMENT_STEPS,
        // Принят → Готов, отмена с причиной; гость после принятия не отменяет
        'accepted -> ready by restaurant',
        'accepted -> cancelled by restaurant',
        'accepted -> cancelled by payment',
        'accepted -> handed_to_external by restaurant',
        // Готов → В пути: курьер «Забрал»
        'ready -> on_the_way by courier',
        'ready -> handed_to_external by restaurant',
        'ready -> cancelled by restaurant',
        // В пути: «Доставил», «Не могу доставить», «Не дозвонился» / «Отказ гостя»
        'on_the_way -> completed by courier',
        'on_the_way -> ready by courier',
        // Отключённый курьер: незавершённые заказы снимаются с него и ждут переназначения
        'on_the_way -> ready by system',
        'problem_at_door -> ready by system',
        'on_the_way -> problem_at_door by courier',
        'on_the_way -> cancelled by restaurant',
        // Проблема у двери: гость ответил, оператор возвращает или отменяет
        'problem_at_door -> completed by courier',
        'problem_at_door -> returned_to_restaurant by restaurant',
        'problem_at_door -> cancelled by restaurant',
      ].sort(),
    );
  });

  it('pickup keeps its kitchen flow, all by the restaurant', () => {
    expect(allowed('pickup')).toEqual(
      [
        ...PAYMENT_STEPS,
        'accepted -> preparing by restaurant',
        'accepted -> cancelled by restaurant',
        'accepted -> cancelled by payment',
        'preparing -> ready by restaurant',
        'preparing -> cancelled by restaurant',
        'ready -> completed by restaurant',
        'ready -> cancelled by restaurant',
      ].sort(),
    );
  });

  it('delivery has no "preparing"; the restaurant does not move a delivery past "ready"', () => {
    expect(
      checkTransition('accepted', 'preparing', 'restaurant', 'delivery'),
    ).toEqual({ ok: false, reason: 'wrong_fulfillment' });
    expect(ok('ready', 'on_the_way', 'restaurant')).toBe(false);
    expect(ok('on_the_way', 'completed', 'restaurant')).toBe(false);
    expect(ok('problem_at_door', 'completed', 'restaurant')).toBe(false);
  });

  it('the courier never accepts, cancels, returns or hands over', () => {
    for (const from of ORDER_STATUSES) {
      for (const to of [
        'accepted',
        'cancelled',
        'returned_to_restaurant',
        'handed_to_external',
      ] as const)
        expect(ok(from, to, 'courier')).toBe(false);
    }
  });

  it('only a payment event can make an order "paid", never the customer', () => {
    for (const actor of ['customer', 'restaurant', 'system'] as const)
      expect(ok('awaiting_payment', 'pending_acceptance', actor)).toBe(false);
  });

  it('the guest cancels only until the restaurant accepts, pickup and delivery alike', () => {
    expect(customerCanCancel('pending_acceptance', 'delivery')).toBe(true);
    expect(customerCanCancel('pending_acceptance', 'pickup')).toBe(true);
    expect(customerCanCancel('accepted', 'delivery')).toBe(false);
    expect(customerCanCancel('accepted', 'pickup')).toBe(false);
    expect(customerCanCancel('preparing', 'pickup')).toBe(false);
    expect(customerCanCancel('on_the_way', 'delivery')).toBe(false);
  });

  it('final states have no way out', () => {
    expect(FINAL_STATUSES).toEqual([
      'completed',
      'cancelled',
      'returned_to_restaurant',
      'handed_to_external',
    ]);
    for (const from of FINAL_STATUSES)
      for (const to of ORDER_STATUSES)
        for (const actor of ACTORS)
          for (const f of ['delivery', 'pickup'] as const)
            expect(checkTransition(from, to, actor, f)).toEqual({
              ok: false,
              reason: 'final',
            });
  });

  it('nextRestaurantStatus follows the fulfillment type and stops a delivery at "ready"', () => {
    expect(nextRestaurantStatus('pending_acceptance', 'delivery')).toBe(
      'accepted',
    );
    expect(nextRestaurantStatus('accepted', 'delivery')).toBe('ready');
    expect(nextRestaurantStatus('ready', 'delivery')).toBeNull();
    expect(nextRestaurantStatus('on_the_way', 'delivery')).toBeNull();
    expect(nextRestaurantStatus('accepted', 'pickup')).toBe('preparing');
    expect(nextRestaurantStatus('preparing', 'pickup')).toBe('ready');
    expect(nextRestaurantStatus('ready', 'pickup')).toBe('completed');
    expect(nextRestaurantStatus('completed', 'pickup')).toBeNull();
    expect(nextRestaurantStatus('awaiting_payment', 'pickup')).toBeNull();
  });
});
