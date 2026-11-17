import { Logger } from '@nestjs/common';
import { AppException } from 'src/infra/errors/app-exception';
import { encodeCourierAction } from './domain/courier-card';
import { newInviteToken } from './domain/courier-invitation';
import { COURIER_TEXTS } from './domain/courier-texts';
import { FAKE_BRANCH_ID, seedVenue } from './courier-prisma.fake';
import { CourierService } from './services/courier.service';
import { BRANCH_B, Ctx, STAFF, act, setup, t } from './courier-setup.fake';

beforeAll(() => {
  for (const level of ['log', 'warn', 'error'] as const)
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
});

describe('courier invitation', () => {
  let s: Ctx;
  beforeEach(async () => (s = await setup()));

  const invitation = async (courierId: string, expiresInMs = 3600_000) => {
    const { token, hash } = newInviteToken();
    await s.db.courier_invitation.create({
      data: {
        courier_id: courierId,
        token_hash: hash,
        expires_at: new Date(Date.now() + expiresInMs),
      },
    });
    return token;
  };

  it('links the courier to the Telegram user once; the same link again is refused', async () => {
    const c = await s.venue.courier();
    const token = await invitation(c.id);
    const first = await s.say('9001', `/start c_${token}`);
    expect(first.replies).toEqual([t.linked('Mant')]);
    expect(s.db.courier.get(c.id)).toMatchObject({
      telegram_user_id: '9001',
      telegram_chat_id: '9001',
    });

    const again = await s.say('9002', `/start c_${token}`);
    expect(again.replies).toEqual([t.inviteInvalid]);
    expect(s.db.courier.get(c.id).telegram_user_id).toBe('9001');
  });

  it('refuses an expired link, a revoked one, a disabled courier and another venue bot', async () => {
    const c = await s.venue.courier();
    expect(
      (await s.say('9001', `/start c_${await invitation(c.id, -1)}`)).replies,
    ).toEqual([t.inviteInvalid]);

    const other = await seedVenue(s.db, 'Other');
    const foreign = await other.courier();
    expect(
      (await s.say('9001', `/start c_${await invitation(foreign.id)}`)).replies,
    ).toEqual([t.inviteInvalid]);

    const token = await invitation(c.id);
    await s.db.courier.update({
      where: { id: c.id },
      data: { is_active: false },
    });
    expect((await s.say('9001', `/start c_${token}`)).replies).toEqual([
      t.inviteInvalid,
    ]);
    expect(s.db.courier.get(c.id).telegram_user_id).toBeNull();
  });

  it('one Telegram account cannot be two couriers of the venue', async () => {
    await s.onShift({ telegram_user_id: '9001' });
    const second = await s.venue.courier();
    expect(
      (await s.say('9001', `/start c_${await invitation(second.id)}`)).replies,
    ).toEqual([t.inviteOtherCourier]);
  });

  it('the dashboard link: one at a time, 24 hours, only the hash stored', async () => {
    const c = await s.venue.courier();
    const first = await s.couriers.invite(s.venue.org.id, c.id);
    const second = await s.couriers.invite(s.venue.org.id, c.id);
    expect(second.link).toMatch(
      /^https:\/\/t\.me\/mant_bot\?start=c_[A-Za-z0-9_-]{43}$/,
    );
    const rows = s.db.courier_invitation.rows;
    expect(rows.filter((r) => !r.revoked_at)).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(second.link.split('start=c_')[1]);
    // the older link no longer works
    expect(
      (await s.say('9001', `/start c_${first.link.split('start=c_')[1]}`)).replies,
    ).toEqual([t.inviteInvalid]);
    expect(
      (await s.say('9001', `/start c_${second.link.split('start=c_')[1]}`)).replies,
    ).toEqual([t.linked('Mant')]);
  });

  it('no working venue bot: telegram_bot_required', async () => {
    const c = await s.venue.courier();
    s.bot.organizationId = 'gone';
    (s as any).couriers = new CourierService(
      s.db as any,
      { forTenant: async () => null } as any,
      s.assignments,
      s.shifts,
      s.cards as any,
    );
    await expect(s.couriers.invite(s.venue.org.id, c.id)).rejects.toMatchObject(
      { code: 'telegram_bot_required' },
    );
  });

  it('a message that is not the courier flow goes on to the guest flow', async () => {
    expect((await s.say('9001', '/start')).handled).toBe(false);
    expect((await s.say('9001', 'hello')).handled).toBe(false);
  });
});

describe('courier shift in the bot', () => {
  let s: Ctx;
  beforeEach(async () => (s = await setup()));

  it('start, start again, end; an order on the courier blocks ending', async () => {
    const c = await s.venue.courier({
      telegram_user_id: '7001',
      telegram_chat_id: '7001',
    });
    expect((await s.say('7001', t.startShift)).replies).toEqual([
      t.shiftStarted,
    ]);
    expect((await s.say('7001', t.startShift)).replies).toEqual([
      t.shiftAlreadyOpen,
    ]);

    const o = await s.venue.order({ status: 'ready' });
    await s.assignments.assign(s.venue.org.id, o.id, c.id, STAFF);
    expect((await s.say('7001', t.endShift)).replies).toEqual([
      t.shiftHasOrders(1),
    ]);
    expect(
      await s.db.courier_shift.count({
        where: { courier_id: c.id, status: 'open' },
      }),
    ).toBe(1);

    await s.press('7001', act('pk', o.id));
    await s.press('7001', act('dl', o.id));
    expect((await s.say('7001', t.endShift)).replies).toEqual([t.shiftEnded]);
    const shift = (await s.db.courier_shift.findFirst({
      where: { courier_id: c.id },
    }))!;
    expect(shift).toMatchObject({
      status: 'awaiting_reconciliation',
      ended_by: 'courier',
    });
    expect((await s.say('7001', t.endShift)).replies).toEqual([t.shiftNotOpen]);
  });

  it('the menu works in any of the three languages', async () => {
    await s.venue.courier({
      telegram_user_id: '7002',
      telegram_chat_id: '7002',
    });
    expect((await s.say('7002', COURIER_TEXTS.uz.startShift)).replies).toEqual([
      t.shiftStarted,
    ]);
  });

  it('the operator closes the shift, not while orders are on the courier', async () => {
    const c = await s.onShift();
    const o = await s.venue.order();
    await s.assignments.assign(s.venue.org.id, o.id, c.id, STAFF);
    const shift = (await s.db.courier_shift.findFirst({
      where: { courier_id: c.id },
    }))!;
    await expect(
      s.shifts.closeByStaff(s.venue.org.id, shift.id, STAFF),
    ).rejects.toMatchObject({
      code: 'courier_has_active_orders',
      details: { activeOrders: 1 },
    });
    await s.assignments.unassign(s.venue.org.id, o.id, STAFF);
    const closed = await s.shifts.closeByStaff(s.venue.org.id, shift.id, STAFF);
    expect(closed).toMatchObject({
      status: 'awaiting_reconciliation',
      endedBy: 'staff',
    });
    expect(s.cards.say).toHaveBeenCalledWith(
      s.bot,
      c.telegram_chat_id,
      t.shiftClosedByStaff,
    );
    await expect(
      s.shifts.closeByStaff('other-org', shift.id, STAFF),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('assignment', () => {
  let s: Ctx;
  beforeEach(async () => (s = await setup()));

  it('only a courier of the venue, active and on shift', async () => {
    const o = await s.venue.order();
    const offShift = await s.venue.courier();
    await expect(
      s.assignments.assign(s.venue.org.id, o.id, offShift.id, STAFF),
    ).rejects.toMatchObject({ code: 'courier_not_on_shift' });

    const disabled = await s.onShift();
    await s.db.courier.update({
      where: { id: disabled.id },
      data: { is_active: false },
    });
    await expect(
      s.assignments.assign(s.venue.org.id, o.id, disabled.id, STAFF),
    ).rejects.toMatchObject({ code: 'courier_inactive' });

    const foreign = await (await seedVenue(s.db, 'Other')).courier();
    await expect(
      s.assignments.assign(s.venue.org.id, o.id, foreign.id, STAFF),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      s.assignments.assign('other-org', o.id, offShift.id, STAFF),
    ).rejects.toMatchObject({ code: 'order_not_found' });
  });

  it('not for pickup or a finished order', async () => {
    const c = await s.onShift();
    const pickup = await s.venue.order({ fulfillment: 'pickup' });
    const done = await s.venue.order({ status: 'completed' });
    for (const o of [pickup, done])
      await expect(
        s.assignments.assign(s.venue.org.id, o.id, c.id, STAFF),
      ).rejects.toMatchObject({ code: 'order_status_conflict' });
  });

  it('several orders on one courier; reassign before "picked up" is journaled and updates both cards', async () => {
    const a = await s.onShift();
    const b = await s.onShift();
    const o1 = await s.venue.order();
    const o2 = await s.venue.order({ status: 'ready' });
    await s.assignments.assign(s.venue.org.id, o1.id, a.id, STAFF);
    await s.assignments.assign(s.venue.org.id, o2.id, a.id, STAFF);
    expect(await s.shifts.activeOrders(a.id)).toBe(2);
    expect(s.order(o1.id).courier_shift_id).toBeTruthy();

    s.queues.enqueueCourierCard.mockClear();
    await s.assignments.assign(s.venue.org.id, o1.id, b.id, STAFF);
    expect(s.order(o1.id).courier_id).toBe(b.id);
    const notes = s.db.order_status_event.rows
      .filter((e) => e.order_id === o1.id)
      .map((e) => e.note);
    expect(notes).toEqual([
      `courier_assigned:${a.id}`,
      `courier_reassigned:${b.id}`,
    ]);
    const cardsFor = s.queues.enqueueCourierCard.mock.calls.map(
      (c) => (c as unknown[])[1],
    );
    expect(cardsFor.sort()).toEqual([a.id, b.id].sort());

    // assigning the same courier again changes nothing
    const version = s.order(o1.id).version;
    await s.assignments.assign(s.venue.org.id, o1.id, b.id, STAFF);
    expect(s.order(o1.id).version).toBe(version);
  });

  it('after "picked up" neither reassign nor take off: order_courier_locked', async () => {
    const a = await s.onShift();
    const b = await s.onShift();
    const o = await s.venue.order({ status: 'ready' });
    await s.assignments.assign(s.venue.org.id, o.id, a.id, STAFF);
    await s.press(a.telegram_user_id, act('pk', o.id));
    expect(s.order(o.id).status).toBe('on_the_way');
    await expect(
      s.assignments.assign(s.venue.org.id, o.id, b.id, STAFF),
    ).rejects.toMatchObject({ code: 'order_courier_locked' });
    await expect(
      s.assignments.unassign(s.venue.org.id, o.id, STAFF),
    ).rejects.toMatchObject({ code: 'order_courier_locked' });
  });
});

describe('courier buttons', () => {
  let s: Ctx;
  let courier: Awaited<ReturnType<Ctx['onShift']>>;
  let tg: string;
  beforeEach(async () => {
    s = await setup();
    courier = await s.onShift();
    tg = courier.telegram_user_id;
  });
  const assigned = async (
    data: Record<string, unknown> = { status: 'ready' },
  ) => {
    const o = await s.venue.order(data);
    await s.assignments.assign(s.venue.org.id, o.id, courier.id, STAFF);
    return o;
  };

  it('picked up → delivered with cash; every press journaled as the courier; a repeated press changes nothing', async () => {
    const o = await assigned();
    expect(await s.press(tg, act('pk', o.id))).toBe(t.done);
    expect(s.order(o.id).status).toBe('on_the_way');
    const version = s.order(o.id).version;
    expect(await s.press(tg, act('pk', o.id))).toBe(t.alreadyDone);
    expect(s.order(o.id).version).toBe(version);

    expect(await s.press(tg, act('dl', o.id))).toBe(t.done);
    expect(s.order(o.id)).toMatchObject({ status: 'completed' });
    expect(await s.press(tg, act('dl', o.id))).toBe(t.alreadyDone);

    const courierSteps = s.db.order_status_event.rows
      .filter((e) => e.order_id === o.id && e.actor === 'courier')
      .map((e) => [e.from_status, e.to_status, e.actor_id]);
    expect(courierSteps).toEqual([
      ['ready', 'on_the_way', courier.id],
      ['on_the_way', 'completed', courier.id],
    ]);
  });

  it('another courier of the venue, a stranger and a disabled courier are refused; the order does not move', async () => {
    const o = await assigned();
    const other = await s.onShift();
    expect(await s.press(other.telegram_user_id, act('pk', o.id))).toBe(
      t.notYours,
    );
    expect(await s.press('424242', act('pk', o.id))).toBe(t.notCourier);

    // a courier of another venue presses this venue bot's button
    const elsewhere = await (
      await seedVenue(s.db, 'Other')
    ).courier({ telegram_user_id: '515151' });
    expect(await s.press(elsewhere.telegram_user_id, act('pk', o.id))).toBe(
      t.notCourier,
    );

    await s.db.courier.update({
      where: { id: courier.id },
      data: { is_active: false },
    });
    expect(await s.press(tg, act('pk', o.id))).toBe(t.disabled);
    expect(s.order(o.id)).toMatchObject({ status: 'ready', version: 1 });
  });

  it('an order of another venue looks foreign; forged button data is refused', async () => {
    const other = await seedVenue(s.db, 'Other');
    const foreign = await other.order({
      status: 'ready',
      courier_id: courier.id,
    });
    expect(await s.press(tg, act('pk', foreign.id))).toBe(t.notYours);
    expect(s.order(foreign.id).status).toBe('ready');
    expect(await s.press(tg, 'cr:pk:not-a-uuid')).toBe(t.notAvailable);
  });

  it('not ready yet: "picked up" is not available', async () => {
    const o = await assigned({ status: 'accepted' });
    expect(await s.press(tg, act('pk', o.id))).toBe(t.notAvailable);
    expect(s.order(o.id).status).toBe('accepted');
  });

  it('payment at the door: only the buttons the venue takes now are accepted (W13-05)', async () => {
    const onTheWay = async (payment_method: string) => {
      const o = await assigned({ status: 'ready', payment_method });
      expect(await s.press(tg, act('pk', o.id))).toBe(t.done);
      return o;
    };
    // the venue takes cash only: "paid by card" on a cash order is refused and the order stays on the way
    s.orderSettings.deliveryPayment = {
      cash: true,
      card: false,
      online: false,
    };
    const cash = await onTheWay('cash');
    expect(await s.press(tg, act('dc', cash.id))).toBe(t.notAvailable);
    expect(s.order(cash.id).status).toBe('on_the_way');
    expect(await s.press(tg, act('dl', cash.id))).toBe(t.done);
    expect(s.order(cash.id)).toMatchObject({
      status: 'completed',
      cash_collected: 'cash',
    });

    // a card order keeps its own button even with card switched off later; the guest may pay cash instead
    const card = await onTheWay('card');
    expect(await s.press(tg, act('dc', card.id))).toBe(t.done);
    expect(s.order(card.id)).toMatchObject({
      status: 'completed',
      cash_collected: 'card',
    });
    const paidCash = await onTheWay('card');
    expect(await s.press(tg, act('dl', paidCash.id))).toBe(t.done);
    expect(s.order(paidCash.id).cash_collected).toBe('cash');

    // online: no card button
    const online = await onTheWay('click');
    expect(await s.press(tg, act('dc', online.id))).toBe(t.notAvailable);
    expect(await s.press(tg, act('dl', online.id))).toBe(t.done);
    expect(s.order(online.id).cash_collected).toBeNull();
  });

  it('"picked up all" takes the ready orders of that branch only', async () => {
    const o1 = await assigned();
    const o2 = await assigned();
    const other = await assigned({ status: 'ready', branch_id: BRANCH_B });
    const cooking = await assigned({ status: 'accepted' });
    const pickAll = encodeCourierAction({
      a: 'pick_all',
      branchId: FAKE_BRANCH_ID,
    });
    expect(await s.press(tg, pickAll)).toBe(t.done);
    expect([o1, o2].map((o) => s.order(o.id).status)).toEqual([
      'on_the_way',
      'on_the_way',
    ]);
    expect(s.order(other.id).status).toBe('ready');
    expect(s.order(cooking.id).status).toBe('accepted');
    expect(await s.press(tg, pickAll)).toBe(t.alreadyDone);
  });

  it('"no answer": the operator is alerted; the guest answered — delivered', async () => {
    const o = await assigned();
    await s.press(tg, act('pk', o.id));
    expect(await s.press(tg, act('na', o.id))).toBe(t.done);
    await s.flush();
    expect(s.order(o.id)).toMatchObject({
      status: 'problem_at_door',
      door_problem: 'no_answer',
    });
    expect(s.restaurant.alertDeliveryProblem).toHaveBeenCalledWith(
      o.id,
      'no_answer',
    );
    expect(await s.press(tg, act('na', o.id))).toBe(t.alreadyDone);
    expect(await s.press(tg, act('dl', o.id))).toBe(t.done);
    expect(s.order(o.id).status).toBe('completed');
  });

  it('"refused" with a reason waits for the operator: no delivery, then return to the restaurant', async () => {
    const o = await assigned();
    await s.press(tg, act('pk', o.id));
    expect(await s.press(tg, act('rf', o.id, ':wrong_order'))).toBe(t.done);
    await s.flush();
    expect(s.order(o.id)).toMatchObject({
      status: 'problem_at_door',
      door_problem: 'refused',
      door_problem_reason: 'wrong_order',
    });
    expect(s.restaurant.alertDeliveryProblem).toHaveBeenCalledWith(
      o.id,
      'refused',
    );
    expect(await s.press(tg, act('dl', o.id))).toBe(t.notAvailable);
    // "no answer" after a refusal is not a repeat of it
    expect(await s.press(tg, act('na', o.id))).toBe(t.notAvailable);

    await s.transitions.transition({
      orderId: o.id,
      to: 'returned_to_restaurant',
      actor: 'restaurant',
      actorId: STAFF,
    });
    expect(s.order(o.id).status).toBe('returned_to_restaurant');
  });

  it('"cannot deliver": ready again without a courier, urgent alert; the courier can no longer act on it', async () => {
    const o = await assigned();
    await s.press(tg, act('pk', o.id));
    s.queues.enqueueCourierCard.mockClear();
    expect(await s.press(tg, act('cd', o.id))).toBe(t.done);
    await s.flush();
    expect(s.order(o.id)).toMatchObject({
      status: 'ready',
      courier_id: null,
      courier_shift_id: null,
    });
    expect(s.restaurant.alertDeliveryProblem).toHaveBeenCalledWith(
      o.id,
      'cannot_deliver',
    );
    // the old card is rebuilt (it becomes "taken off you")
    expect(s.queues.enqueueCourierCard).toHaveBeenCalledWith(
      o.id,
      courier.id,
      expect.any(Number),
    );
    expect(await s.press(tg, act('cd', o.id))).toBe(t.alreadyDone);
    expect(await s.press(tg, act('pk', o.id))).toBe(t.notYours);

    // the operator assigns another courier at once
    const next = await s.onShift();
    await s.assignments.assign(s.venue.org.id, o.id, next.id, STAFF);
    expect(await s.press(next.telegram_user_id, act('pk', o.id))).toBe(t.done);
  });

  it('the refusal menu rebuilds the card on the spot, only for the courier on the way', async () => {
    const o = await assigned();
    expect(await s.press(tg, act('rm', o.id))).toBe(t.notAvailable);
    await s.press(tg, act('pk', o.id));
    await s.press(tg, act('rm', o.id));
    expect(s.cards.refresh).toHaveBeenLastCalledWith(o.id, courier.id, {
      refuseMenu: true,
    });
    await s.press(tg, act('bk', o.id));
    expect(s.cards.refresh).toHaveBeenLastCalledWith(o.id, courier.id, {
      refuseMenu: false,
    });
  });

  it('"My orders" resends the cards of the unfinished orders', async () => {
    const o1 = await assigned();
    const o2 = await assigned({ status: 'accepted' });
    await s.say(tg, t.myOrders);
    expect(s.cards.refresh.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      o1.id,
      o2.id,
    ]);
  });
});

describe('disabling a courier', () => {
  it('takes off every unfinished order (on the way ones go back to ready), ends the shift and voids invitations', async () => {
    const s = await setup();
    const c = await s.onShift();
    const waiting = await s.venue.order();
    const onTheWay = await s.venue.order({ status: 'ready' });
    await s.assignments.assign(s.venue.org.id, waiting.id, c.id, STAFF);
    await s.assignments.assign(s.venue.org.id, onTheWay.id, c.id, STAFF);
    await s.press(c.telegram_user_id, act('pk', onTheWay.id));
    await s.db.courier_invitation.create({
      data: {
        courier_id: c.id,
        token_hash: 'h',
        expires_at: new Date(Date.now() + 1000),
      },
    });

    const view = await s.couriers.disable(s.venue.org.id, c.id, STAFF);
    expect(view).toMatchObject({ isActive: false });
    expect(s.order(waiting.id)).toMatchObject({
      status: 'accepted',
      courier_id: null,
    });
    expect(s.order(onTheWay.id)).toMatchObject({
      status: 'ready',
      courier_id: null,
    });
    const systemStep = s.db.order_status_event.rows.find(
      (e) => e.order_id === onTheWay.id && e.actor === 'system',
    );
    expect(systemStep).toMatchObject({
      from_status: 'on_the_way',
      to_status: 'ready',
      note: `courier_disabled:${c.id}`,
    });
    expect(
      await s.db.courier_shift.count({
        where: { courier_id: c.id, status: 'open' },
      }),
    ).toBe(0);
    expect(s.db.courier_invitation.rows.every((r) => r.revoked_at)).toBe(true);
    expect(s.cards.say).toHaveBeenCalledWith(
      s.bot,
      c.telegram_chat_id,
      t.disabled,
      { remove_keyboard: true },
    );

    // access is gone at once
    expect(await s.press(c.telegram_user_id, act('pk', onTheWay.id))).toBe(
      t.disabled,
    );
    await expect(
      s.couriers.invite(s.venue.org.id, c.id),
    ).rejects.toBeInstanceOf(AppException);
  });
});

describe('couriers in the dashboard', () => {
  it('adds a courier, refuses a second one with the phone, lists the state of each', async () => {
    const s = await setup();
    const org = s.venue.org.id;
    const free = await s.couriers.create(org, {
      name: 'Bekzod',
      phone: '+998901234567',
    });
    expect(free).toMatchObject({
      isActive: true,
      linked: false,
      state: 'off_shift',
      activeOrders: 0,
      shift: null,
    });
    await expect(
      s.couriers.create(org, { name: 'Twin', phone: '+998901234567' }),
    ).rejects.toMatchObject({ code: 'courier_phone_taken' });
    // the same phone at another venue is another courier
    const other = await seedVenue(s.db, 'Other');
    await expect(
      s.couriers.create(other.org.id, { name: 'Twin', phone: '+998901234567' }),
    ).resolves.toBeDefined();

    const busy = await s.onShift();
    await s.shifts.start(org, free.id);
    const o = await s.venue.order();
    await s.assignments.assign(org, o.id, busy.id, STAFF);
    const list = await s.couriers.list(org);
    expect(list.map((c) => [c.id, c.state, c.activeOrders])).toEqual(
      expect.arrayContaining([
        [free.id, 'free', 0],
        [busy.id, 'busy', 1],
      ]),
    );
    expect(list.every((c) => c.id !== other.org.id)).toBe(true);
    await expect(s.couriers.get('other-org', free.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
