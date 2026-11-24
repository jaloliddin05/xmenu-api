import { tashkentDay } from 'src/modules/sms/sms-budget.service';
import type { OrderStatusName } from './order-state-machine';

/**
 * The operator's order board (GET /order/board, docs/API.md, "Доска заказов"): live orders in a light form, what
 * needs the operator's attention and the acceptance deadline, all counted here so every screen shows the same.
 */

/** Why an order on the board needs the operator (several may hold at once). */
export const ATTENTION_CODES = [
  /** A delivery accepted or ready, nobody assigned */
  'no_courier',
  /** Ready with a courier, "picked up" not pressed for pickupReminderMinutes */
  'not_picked_up',
  /** On the way longer than onTheWayAlertMinutes */
  'long_on_the_way',
  /** The courier reported a problem at the door */
  'at_door',
  /** Back to ready after a courier's trip (cannot deliver, or the courier was disabled): assign another one */
  'courier_returned',
  /** The transfer to iiko is stuck: not sent, or a street to pick */
  'pos_needs_action',
] as const;
export type AttentionCode = (typeof ATTENTION_CODES)[number];

export interface BoardThresholds {
  pickupReminderMinutes: number;
  onTheWayAlertMinutes: number;
  /** iiko delivers with its own couriers: the courier codes do not apply */
  posCouriers: boolean;
}

/** A journal entry: from → to at a moment (`recordInTx` entries have from = to). */
export interface BoardEvent {
  from_status: string | null;
  to_status: string;
  created_at: Date;
}

export interface BoardOrderFacts {
  status: OrderStatusName;
  fulfillment: 'delivery' | 'pickup';
  created_at: Date;
  courier_id: string | null;
  ready_at: Date | null;
  picked_up_at: Date | null;
  pos_state: string | null;
}

const MINUTE = 60_000;

/**
 * The entry that brought the order into its current status, newest first in `events`. Entries without a status
 * change (a courier assigned) are skipped. Null for an order without such an entry (data from before the journal).
 */
export function statusEntry(
  status: OrderStatusName,
  eventsNewestFirst: readonly BoardEvent[],
): BoardEvent | null {
  return (
    eventsNewestFirst.find(
      (e) => e.to_status === status && e.from_status !== e.to_status,
    ) ?? null
  );
}

/** Moment the order entered its current status; the creation time when the journal has no entry. */
export function statusSince(
  order: Pick<BoardOrderFacts, 'status' | 'created_at'>,
  eventsNewestFirst: readonly BoardEvent[],
): Date {
  return (
    statusEntry(order.status, eventsNewestFirst)?.created_at ?? order.created_at
  );
}

/**
 * When the order is cancelled for want of an answer: entering pending_acceptance plus the venue's timeout (an
 * online order waits for the payment first, so the creation time would be too early). Null in other statuses.
 */
export function acceptDeadlineAt(
  status: OrderStatusName,
  since: Date,
  acceptanceTimeoutSeconds: number,
): Date | null {
  if (status !== 'pending_acceptance') return null;
  return new Date(since.getTime() + acceptanceTimeoutSeconds * 1000);
}

/** The street line of the address only: no entrance, floor, flat, comment or phone. Null for pickup. */
export function shortAddress(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const line = (snapshot as { address?: unknown }).address;
  return typeof line === 'string' && line.trim() ? line.trim() : null;
}

/** Up to this many positions are previewed on a card. */
export const ITEMS_PREVIEW = 4;

export function itemsSummary(
  items: readonly { name: string; quantity: number; position: number }[],
) {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  return {
    itemsCount: sorted.reduce((n, i) => n + i.quantity, 0),
    itemsPreview: sorted
      .slice(0, ITEMS_PREVIEW)
      .map((i) => ({ name: i.name, quantity: i.quantity })),
  };
}

/**
 * What needs the operator, ported from the dashboard (orderAttention, posOrderNeedsAction). The courier codes
 * are for deliveries of venues whose couriers Xmenu manages (not iiko's).
 * `enteredFrom`: the status the order came into its current one from.
 */
export function attention(
  order: BoardOrderFacts,
  enteredFrom: string | null,
  thresholds: BoardThresholds,
  now: Date,
): AttentionCode[] {
  const out: AttentionCode[] = [];
  if (order.pos_state === 'failed' || order.pos_state === 'needs_street')
    out.push('pos_needs_action');
  if (order.fulfillment !== 'delivery' || thresholds.posCouriers) return out;

  const minutesSince = (d: Date | null) =>
    d ? (now.getTime() - d.getTime()) / MINUTE : null;
  switch (order.status) {
    case 'problem_at_door':
      out.push('at_door');
      break;
    case 'on_the_way': {
      const m = minutesSince(order.picked_up_at);
      if (m !== null && m >= thresholds.onTheWayAlertMinutes)
        out.push('long_on_the_way');
      break;
    }
    case 'ready':
      if (order.courier_id) {
        const m = minutesSince(order.ready_at);
        if (m !== null && m >= thresholds.pickupReminderMinutes)
          out.push('not_picked_up');
      } else {
        out.push('no_courier');
        if (enteredFrom === 'on_the_way' || enteredFrom === 'problem_at_door')
          out.push('courier_returned');
      }
      break;
    case 'accepted':
      if (!order.courier_id) out.push('no_courier');
      break;
  }
  return out;
}

/** The longest in its status first; the order number settles a tie. */
export const byStatusSince = (
  a: { statusSince: string; number: number },
  b: { statusSince: string; number: number },
) => a.statusSince.localeCompare(b.statusSince) || a.number - b.number;

/** Start of the current calendar day in Tashkent. */
export function tashkentDayStart(now: Date): Date {
  return new Date(`${tashkentDay(now.getTime())}T00:00:00+05:00`);
}
