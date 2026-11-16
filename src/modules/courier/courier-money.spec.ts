import { Logger } from '@nestjs/common';
import { FAKE_BRANCH_POINT, seedVenue } from './courier-prisma.fake';
import { Ctx, STAFF, act, setup, t } from './courier-setup.fake';
import { ExternalServiceProvider } from './provider/external-service.provider';
import { CourierPayService } from './services/courier-pay.service';
import { DeliveryTimerProcessor } from './services/delivery-timer.processor';
import { ExternalDeliveryService } from './services/external-delivery.service';

beforeAll(() => {
  for (const level of ['log', 'warn', 'error'] as const)
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
});

const tick = () => new Promise((r) => setTimeout(r, 2));

describe('handing an order to an external service', () => {
  let s: Ctx;
  let provider: ExternalServiceProvider;
  let external: ExternalDeliveryService;
  beforeEach(async () => {
    s = await setup();
    provider = new ExternalServiceProvider(s.db as any, s.transitions);
    external = new ExternalDeliveryService(s.db as any, s.transitions);
  });
  const handTo = (orderId: string, service = 'Yandex Go', cost = 25_000) =>
    provider.create(s.venue.org.id, orderId, {
      actorId: STAFF,
      external: { service, cost },
    });

  it('from accepted or ready without a courier: closed at once with the service and its cost', async () => {
    for (const status of ['accepted', 'ready']) {
      const o = await s.venue.order({ status });
      await handTo(o.id);
      expect(s.order(o.id)).toMatchObject({
        status: 'handed_to_external',
        external_service: 'Yandex Go',
        external_cost: 25_000,
        external_cash_received: null,
      });
      expect(s.order(o.id).external_handed_at).toBeInstanceOf(Date);
      expect(await provider.status(s.venue.org.id, o.id)).toMatchObject({
        provider: 'external_service',
        stage: 'closed',
        externalService: 'Yandex Go',
      });
    }
  });

  it('refused with an own courier assigned, on the way, for pickup and for another venue', async () => {
    const c = await s.onShift();
    const withCourier = await s.venue.order({ status: 'ready' });
    await s.assignments.assign(s.venue.org.id, withCourier.id, c.id, STAFF);
    await expect(handTo(withCourier.id)).rejects.toMatchObject({
      code: 'order_courier_assigned',
    });
    expect(s.order(withCourier.id).status).toBe('ready');

    // Taken off: now it can go
    await s.assignments.unassign(s.venue.org.id, withCourier.id, STAFF);
    await handTo(withCourier.id);
    expect(s.order(withCourier.id).status).toBe('handed_to_external');

    const onTheWay = await s.venue.order({ status: 'on_the_way' });
    await expect(handTo(onTheWay.id)).rejects.toMatchObject({
      code: 'order_status_conflict',
    });
    const pickup = await s.venue.order({ fulfillment: 'pickup' });
    await expect(handTo(pickup.id)).rejects.toMatchObject({
      code: 'order_status_conflict',
    });
    const other = await (await seedVenue(s.db, 'Other')).order();
    await expect(handTo(other.id)).rejects.toMatchObject({
      code: 'order_not_found',
    });
  });

  it('the cash mark: once, only for a handed-over cash order, journaled', async () => {
    const cash = await s.venue.order();
    await handTo(cash.id);
    await external.markPayment(s.venue.org.id, cash.id, false, STAFF);
    expect(s.order(cash.id).external_cash_received).toBe(false);
    await expect(
      external.markPayment(s.venue.org.id, cash.id, true, STAFF),
    ).rejects.toMatchObject({ code: 'external_payment_not_pending' });
    expect(s.order(cash.id).external_cash_received).toBe(false);
    expect(
      s.db.order_status_event.rows.filter(
        (e) =>
          e.order_id === cash.id && e.note === 'external_cash_not_received',
      ),
    ).toHaveLength(1);

    // a card to the courier is paid at the door too: the service collected it, the operator marks it
    const card = await s.venue.order({ payment_method: 'card' });
    await handTo(card.id);
    expect(s.order(card.id).external_cash_received).toBeNull();
    await external.markPayment(s.venue.org.id, card.id, true, STAFF);
    expect(s.order(card.id).external_cash_received).toBe(true);

    const online = await s.venue.order({ payment_method: 'click' });
    await handTo(online.id);
    await expect(
      external.markPayment(s.venue.org.id, online.id, true, STAFF),
    ).rejects.toMatchObject({ code: 'external_payment_not_pending' });
    const notHanded = await s.venue.order();
    await expect(
      external.markPayment(s.venue.org.id, notHanded.id, true, STAFF),
    ).rejects.toMatchObject({ code: 'external_payment_not_pending' });
    const other = await (await seedVenue(s.db, 'Other')).order();
    await expect(
      external.markPayment(s.venue.org.id, other.id, true, STAFF),
    ).rejects.toMatchObject({ code: 'order_not_found' });
  });

  it('suggestions: names used before, the most recent first, each once, this venue only', async () => {
    for (const name of ['Taxi', 'Yandex Go', 'Taxi', 'Noor']) {
      await handTo((await s.venue.order()).id, name);
      await tick();
    }
    const other = await seedVenue(s.db, 'Other');
    await provider.create(other.org.id, (await other.order()).id, {
      actorId: STAFF,
      external: { service: 'Millennium', cost: 1 },
    });
    expect(await external.suggestions(s.venue.org.id)).toEqual([
      'Noor',
      'Taxi',
      'Yandex Go',
    ]);
  });
});

describe('delivery timers', () => {
  let s: Ctx;
  let timers: DeliveryTimerProcessor;
  let courier: Awaited<ReturnType<Ctx['onShift']>>;
  beforeEach(async () => {
    s = await setup();
    courier = await s.onShift();
    timers = new DeliveryTimerProcessor(
      s.db as any,
      s.queues as any,
      s.restaurant as any,
      { forTenant: async () => s.bot } as any,
      s.cards as any,
    );
  });
  type Scheduled = { kind: string; since: Date; dueAt: Date } | null;
  /** The timer the last status change scheduled (null: none, the pending ones only removed). */
  const lastTimer = async (): Promise<Scheduled> => {
    await s.flush();
    const calls = s.queues.resetDeliveryTimers.mock.calls;
    return calls[calls.length - 1][1] as Scheduled;
  };
  const readyWithCourier = async () => {
    const o = await s.venue.order();
    await s.assignments.assign(s.venue.org.id, o.id, courier.id, STAFF);
    await s.transitions.transition({
      orderId: o.id,
      to: 'ready',
      actor: 'restaurant',
    });
    return o;
  };
  const fire = (
    orderId: string,
    kind: 'pickup' | 'road' | 'door',
    since: Date,
  ) => timers.fire({ orderId, kind, since: since.getTime() });

  it('ready schedules the pickup reminder after the venue setting; it reminds the courier and the branch chat', async () => {
    s.orderSettings.pickupReminderMinutes = 7;
    const o = await readyWithCourier();
    const timer = (await lastTimer())!;
    expect(timer.kind).toBe('pickup');
    expect(timer.dueAt.getTime() - timer.since.getTime()).toBe(7 * 60_000);
    expect(timer.since).toEqual(s.order(o.id).ready_at);

    s.cards.say.mockClear();
    expect(await fire(o.id, 'pickup', timer.since)).toBe(true);
    expect(s.restaurant.alertDeliveryTimer).toHaveBeenCalledWith(
      o.id,
      'pickup',
    );
    expect(s.cards.say).toHaveBeenCalledWith(
      s.bot,
      courier.telegram_chat_id,
      t.pickupReminder(s.order(o.id).number),
    );
  });

  it('a status change cancels: "picked up" removes the reminder and starts the road timer; old jobs do nothing', async () => {
    const o = await readyWithCourier();
    const pickup = (await lastTimer())!;
    await s.press(courier.telegram_user_id, act('pk', o.id));
    const road = (await lastTimer())!;
    expect(road.kind).toBe('road');
    expect(road.dueAt.getTime() - road.since.getTime()).toBe(60 * 60_000);

    s.restaurant.alertDeliveryTimer.mockClear();
    expect(await fire(o.id, 'pickup', pickup.since)).toBe(false);
    expect(s.restaurant.alertDeliveryTimer).not.toHaveBeenCalled();

    // On the way too long: the branch chat only
    s.cards.say.mockClear();
    expect(await fire(o.id, 'road', road.since)).toBe(true);
    expect(s.restaurant.alertDeliveryTimer).toHaveBeenCalledWith(o.id, 'road');
    expect(s.cards.say).not.toHaveBeenCalled();

    // Delivered: every pending timer is removed, none is scheduled
    await s.press(courier.telegram_user_id, act('dl', o.id));
    expect(await lastTimer()).toBeNull();
    expect(await fire(o.id, 'road', road.since)).toBe(false);
  });

  it('"cannot deliver": a new pickup episode, the old job is stale; without a courier the branch chat only', async () => {
    const o = await readyWithCourier();
    const first = (await lastTimer())!;
    await s.press(courier.telegram_user_id, act('pk', o.id));
    await tick();
    await s.press(courier.telegram_user_id, act('cd', o.id));
    const second = (await lastTimer())!;
    expect(second.kind).toBe('pickup');
    expect(second.since.getTime()).toBeGreaterThan(first.since.getTime());
    expect(await fire(o.id, 'pickup', first.since)).toBe(false);

    s.cards.say.mockClear();
    expect(await fire(o.id, 'pickup', second.since)).toBe(true);
    expect(s.cards.say).not.toHaveBeenCalled();
  });

  it('the door timer runs after "no answer" only; when it is over the operator decides and the courier is told', async () => {
    s.orderSettings.doorWaitMinutes = 12;
    const o = await readyWithCourier();
    await s.press(courier.telegram_user_id, act('pk', o.id));
    await s.press(courier.telegram_user_id, act('na', o.id));
    const door = (await lastTimer())!;
    expect(door.kind).toBe('door');
    expect(door.dueAt.getTime() - door.since.getTime()).toBe(12 * 60_000);

    s.cards.say.mockClear();
    expect(await fire(o.id, 'door', door.since)).toBe(true);
    expect(s.restaurant.alertDeliveryTimer).toHaveBeenCalledWith(o.id, 'door');
    expect(s.cards.say).toHaveBeenCalledWith(
      s.bot,
      courier.telegram_chat_id,
      t.doorWaitOver(s.order(o.id).number),
    );

    // The guest answered: delivered, the door job is stale
    await s.press(courier.telegram_user_id, act('dl', o.id));
    expect(await fire(o.id, 'door', door.since)).toBe(false);

    const refused = await readyWithCourier();
    await s.press(courier.telegram_user_id, act('pk', refused.id));
    await s.press(courier.telegram_user_id, act('rf', refused.id, ':quality'));
    expect(await lastTimer()).toBeNull();
  });

  it('pickup orders get no delivery timers', async () => {
    const o = await s.venue.order({ fulfillment: 'pickup' });
    s.queues.resetDeliveryTimers.mockClear();
    await s.transitions.transition({
      orderId: o.id,
      to: 'preparing',
      actor: 'restaurant',
    });
    await s.flush();
    expect(s.queues.resetDeliveryTimers).not.toHaveBeenCalled();
  });
});

describe('shift cash and courier pay', () => {
  let s: Ctx;
  let courier: Awaited<ReturnType<Ctx['onShift']>>;
  let tg: string;
  beforeEach(async () => {
    s = await setup();
    courier = await s.onShift();
    tg = courier.telegram_user_id;
  });
  /** About 5 km north of the fake branch */
  const FAR = {
    latitude: FAKE_BRANCH_POINT.latitude + 0.045,
    longitude: FAKE_BRANCH_POINT.longitude,
  };
  const deliver = async (
    data: Record<string, unknown>,
    button: 'dl' | 'dc' = 'dl',
  ) => {
    const o = await s.venue.order({ status: 'ready', ...data });
    await s.assignments.assign(s.venue.org.id, o.id, courier.id, STAFF);
    await s.press(tg, act('pk', o.id));
    expect(await s.press(tg, act(button, o.id))).toBe(t.done);
    return s.order(o.id);
  };
  const shiftId = () =>
    s.db.courier_shift.rows.find((r) => r.courier_id === courier.id)!.id;

  it('"paid by card" marks the cash order; banknotes by default; online orders keep no mark', async () => {
    expect((await deliver({ total: 50_000 }, 'dc')).cash_collected).toBe(
      'card',
    );
    expect((await deliver({ total: 70_000 })).cash_collected).toBe('cash');
    expect(
      (await deliver({ total: 90_000, payment_method: 'click' }))
        .cash_collected,
    ).toBeNull();
  });

  it('a card order counts as card unless the courier took banknotes (W13-05)', async () => {
    await deliver({ total: 40_000, payment_method: 'card' }, 'dc');
    await deliver({ total: 60_000, payment_method: 'card' });
    expect((await s.shifts.get(s.venue.org.id, shiftId())).cash).toMatchObject({
      deliveries: 2,
      due: 60_000,
      card: 40_000,
    });
  });

  it('to hand in: delivered cash only (not card, online, returned); reconciled once, the discrepancy kept', async () => {
    await deliver({ total: 120_000 });
    await deliver({ total: 80_000 });
    await deliver({ total: 50_000 }, 'dc');
    await deliver({ total: 90_000, payment_method: 'click' });
    const returned = await s.venue.order({ status: 'ready', total: 300_000 });
    await s.assignments.assign(s.venue.org.id, returned.id, courier.id, STAFF);
    await s.press(tg, act('pk', returned.id));
    await s.press(tg, act('rf', returned.id, ':quality'));
    await s.transitions.transition({
      orderId: returned.id,
      to: 'returned_to_restaurant',
      actor: 'restaurant',
    });

    expect((await s.shifts.get(s.venue.org.id, shiftId())).cash).toEqual({
      deliveries: 4,
      due: 200_000,
      card: 50_000,
      received: null,
      discrepancy: null,
    });
    // An open shift is not reconciled
    await expect(
      s.shifts.reconcile(s.venue.org.id, shiftId(), 200_000, STAFF),
    ).rejects.toMatchObject({ code: 'shift_not_awaiting_reconciliation' });

    await s.shifts.end(courier.id, { by: 'courier' });
    const done = await s.shifts.reconcile(
      s.venue.org.id,
      shiftId(),
      195_000,
      STAFF,
    );
    expect(done.status).toBe('reconciled');
    expect(done.cash).toMatchObject({
      due: 200_000,
      received: 195_000,
      discrepancy: -5_000,
    });
    expect(done.reconciledAt).not.toBeNull();
    await expect(
      s.shifts.reconcile(s.venue.org.id, shiftId(), 200_000, STAFF),
    ).rejects.toMatchObject({ code: 'shift_not_awaiting_reconciliation' });
    expect(s.db.courier_shift.get(shiftId())).toMatchObject({
      cash_due: 200_000,
      cash_received: 195_000,
      cash_discrepancy: -5_000,
      reconciled_by_user_id: STAFF,
    });

    const other = await seedVenue(s.db, 'Other');
    await expect(
      s.shifts.reconcile(other.org.id, shiftId(), 1, STAFF),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('pay at delivery: nothing without a rate; the venue rate plus started km; the own rate wins; fixed in the order', async () => {
    const noRate = await deliver({ address_snapshot: FAR });
    expect(noRate.courier_pay).toBeNull();
    expect(noRate.courier_distance_km).toBeCloseTo(5.0, 1);

    s.orderSettings.courierPay = {
      perDelivery: 10_000,
      includedKm: 3,
      perKm: 2_000,
    };
    const venueRate = await deliver({ address_snapshot: FAR });
    const extraKm = Math.ceil(venueRate.courier_distance_km - 3 - 1e-9);
    expect(extraKm).toBeGreaterThanOrEqual(2);
    expect(venueRate.courier_pay).toBe(10_000 + extraKm * 2_000);

    expect(
      (await deliver({ address_snapshot: FAKE_BRANCH_POINT })).courier_pay,
    ).toBe(10_000);
    expect(
      await deliver({ address_snapshot: { address: 'Chilonzor' } }),
    ).toMatchObject({ courier_pay: 10_000, courier_distance_km: 0 });

    const pay = new CourierPayService(
      s.db as any,
      { get: async () => s.orderSettings } as any,
    );
    await pay.setRate(s.venue.org.id, courier.id, {
      perDelivery: 15_000,
      includedKm: 10,
      perKm: 1_000,
    });
    expect((await deliver({ address_snapshot: FAR })).courier_pay).toBe(15_000);
    const rates = await pay.rates(s.venue.org.id);
    expect(rates.venue).toEqual(s.orderSettings.courierPay);
    expect(
      rates.couriers.find((c) => c.courierId === courier.id)?.rate,
    ).toEqual({ perDelivery: 15_000, includedKm: 10, perKm: 1_000 });

    // Rates changed later: accrued pay stays
    s.orderSettings.courierPay = null;
    await pay.setRate(s.venue.org.id, courier.id, null);
    expect(s.order(venueRate.id).courier_pay).toBe(10_000 + extraKm * 2_000);
    const other = await seedVenue(s.db, 'Other');
    await expect(
      pay.setRate(other.org.id, courier.id, null),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
