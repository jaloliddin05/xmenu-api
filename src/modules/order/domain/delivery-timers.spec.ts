import {
  deliveryTimerFor,
  doorWaitEndsAt,
  timerStillDue,
} from './delivery-timers';

const SETTINGS = {
  pickupReminderMinutes: 5,
  onTheWayAlertMinutes: 60,
  doorWaitMinutes: 10,
};
const AT = new Date('2026-11-16T10:00:00Z');
const order = (o: Record<string, unknown>) => ({
  status: 'accepted',
  door_problem: null,
  ready_at: null,
  picked_up_at: null,
  door_problem_at: null,
  ...o,
});
const min = (n: number) => new Date(AT.getTime() + n * 60_000);

describe('delivery timers', () => {
  it('one timer per status: ready → pickup, on the way → road, no answer → door', () => {
    expect(
      deliveryTimerFor(order({ status: 'ready', ready_at: AT }), SETTINGS),
    ).toEqual({ kind: 'pickup', since: AT, dueAt: min(5) });
    expect(
      deliveryTimerFor(
        order({ status: 'on_the_way', picked_up_at: AT }),
        SETTINGS,
      ),
    ).toEqual({ kind: 'road', since: AT, dueAt: min(60) });
    expect(
      deliveryTimerFor(
        order({
          status: 'problem_at_door',
          door_problem: 'no_answer',
          door_problem_at: AT,
        }),
        SETTINGS,
      ),
    ).toEqual({ kind: 'door', since: AT, dueAt: min(10) });
  });

  it('no timer: accepted, refused at the door, finished orders', () => {
    for (const o of [
      order({}),
      order({
        status: 'problem_at_door',
        door_problem: 'refused',
        door_problem_at: AT,
      }),
      order({ status: 'completed', ready_at: AT, picked_up_at: AT }),
      order({ status: 'handed_to_external', ready_at: AT }),
    ])
      expect(deliveryTimerFor(o, SETTINGS)).toBeNull();
  });

  it('a job acts only in the episode it was scheduled for', () => {
    const ready = order({ status: 'ready', ready_at: AT });
    expect(timerStillDue('pickup', AT.getTime(), ready)).toBe(true);
    // ready again later ("cannot deliver"): a new episode
    expect(
      timerStillDue('pickup', AT.getTime(), { ...ready, ready_at: min(30) }),
    ).toBe(false);
    expect(
      timerStillDue('pickup', AT.getTime(), {
        ...ready,
        status: 'on_the_way',
        picked_up_at: min(1),
      }),
    ).toBe(false);
    expect(timerStillDue('road', AT.getTime(), ready)).toBe(false);
  });

  it('door wait end for the staff view', () => {
    expect(
      doorWaitEndsAt(
        order({
          status: 'problem_at_door',
          door_problem: 'no_answer',
          door_problem_at: AT,
        }),
        SETTINGS,
      ),
    ).toEqual(min(10));
    expect(
      doorWaitEndsAt(order({ status: 'ready', ready_at: AT }), SETTINGS),
    ).toBeNull();
  });
});
