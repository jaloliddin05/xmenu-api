/**
 * Delivery timers (docs/DELIVERY.md, "Напоминания", "Проблемные ситуации"), one per status episode:
 *  - pickup: "picked up" not pressed this long after "ready" → remind the courier and the operator;
 *  - road: on the way longer → alert the operator;
 *  - door: waiting at the door after "no answer" is over → the operator decides (return or cancel).
 * A status change removes the pending job; the job also checks that the order is still in the same episode
 * (same status, same start moment), so a job that slipped through a race does nothing.
 */
export const DELIVERY_TIMER_KINDS = ['pickup', 'road', 'door'] as const;
export type DeliveryTimerKind = (typeof DELIVERY_TIMER_KINDS)[number];

export interface DeliveryTimerOrder {
  status: string;
  door_problem: string | null;
  ready_at: Date | null;
  picked_up_at: Date | null;
  door_problem_at: Date | null;
}

export interface DeliveryTimerSettings {
  pickupReminderMinutes: number;
  onTheWayAlertMinutes: number;
  doorWaitMinutes: number;
}

export interface DeliveryTimer {
  kind: DeliveryTimerKind;
  /** When the status episode started (the job carries it to tell episodes apart) */
  since: Date;
  dueAt: Date;
}

/** The moment the timer of this kind counts from, when the order is in its episode now. */
function episodeStart(
  kind: DeliveryTimerKind,
  order: DeliveryTimerOrder,
): Date | null {
  switch (kind) {
    case 'pickup':
      return order.status === 'ready' ? order.ready_at : null;
    case 'road':
      return order.status === 'on_the_way' ? order.picked_up_at : null;
    case 'door':
      return order.status === 'problem_at_door' &&
        order.door_problem === 'no_answer'
        ? order.door_problem_at
        : null;
  }
}

const MINUTES: Record<DeliveryTimerKind, keyof DeliveryTimerSettings> = {
  pickup: 'pickupReminderMinutes',
  road: 'onTheWayAlertMinutes',
  door: 'doorWaitMinutes',
};

/** The timer the order needs in its current status, or null (no delivery timer in this status). */
export function deliveryTimerFor(
  order: DeliveryTimerOrder,
  settings: DeliveryTimerSettings,
): DeliveryTimer | null {
  for (const kind of DELIVERY_TIMER_KINDS) {
    const since = episodeStart(kind, order);
    if (since)
      return {
        kind,
        since,
        dueAt: new Date(since.getTime() + settings[MINUTES[kind]] * 60_000),
      };
  }
  return null;
}

/** The job fires: act only while the order is still in the episode the job was scheduled for. */
export function timerStillDue(
  kind: DeliveryTimerKind,
  since: number,
  order: DeliveryTimerOrder,
): boolean {
  return episodeStart(kind, order)?.getTime() === since;
}

/** Until when the courier waits at the door after "no answer" (null outside that episode). */
export function doorWaitEndsAt(
  order: DeliveryTimerOrder,
  settings: DeliveryTimerSettings,
): Date | null {
  const t = deliveryTimerFor(order, settings);
  return t?.kind === 'door' ? t.dueAt : null;
}
