import {
  isFinalStatus,
  type OrderStatusName,
} from 'src/modules/order/domain/order-state-machine';
import type { PosDeliveryStatus } from '../provider/pos-provider';

/** Order of the iiko delivery statuses: an event below the last one seen goes back. */
const POS_RANK: Record<PosDeliveryStatus, number> = {
  Unconfirmed: 0,
  WaitCooking: 1,
  ReadyForCooking: 1,
  CookingStarted: 2,
  CookingCompleted: 3,
  Waiting: 4,
  OnWay: 5,
  Delivered: 6,
  Closed: 7,
  Cancelled: 8,
};

/** The path an order of each kind takes after "accepted" (order-state-machine.ts). */
const PATH: Record<'delivery' | 'pickup', OrderStatusName[]> = {
  delivery: ['accepted', 'ready', 'on_the_way', 'completed'],
  pickup: ['accepted', 'preparing', 'ready', 'completed'],
};

export interface PosStatusInput {
  status: PosDeliveryStatus;
  /** pos_order.pos_status: the last iiko status taken into account */
  previous: string | null;
  order: { status: OrderStatusName; fulfillment: 'delivery' | 'pickup' };
  courierMode: 'xmenu' | 'iiko';
}

export interface PosStatusDecision {
  /** Nothing new (the same status again): no journal entry */
  repeat: boolean;
  /** Xmenu statuses to go through, in order (actor pos) */
  steps: OrderStatusName[];
  /** Cancel the order (reason pos_cancelled) */
  cancel: boolean;
  /** Confirm the order in iiko (it waits for a second acceptance) */
  confirm: boolean;
  /** The operator is alerted: the event goes back or contradicts the order */
  alert: 'conflict' | 'cancelled' | null;
}

const none = (over: Partial<PosStatusDecision> = {}): PosStatusDecision => ({
  repeat: false,
  steps: [],
  cancel: false,
  confirm: false,
  alert: null,
  ...over,
});

/**
 * What an iiko status does to an Xmenu order (docs/IIKO.md, "Путь заказа и статусы"): statuses
 * only move forward; an event that goes back or contradicts the order is written to the journal
 * and raises an alert without changing the status. With the venue's own couriers "on the way" and
 * "delivered" come from the courier, and iiko closing the order changes nothing.
 */
export function decidePosStatus(input: PosStatusInput): PosStatusDecision {
  const { status, order, courierMode } = input;
  const previous = input.previous as PosDeliveryStatus | null;
  if (previous === status) return none({ repeat: true });
  const final = isFinalStatus(order.status);

  if (status === 'Cancelled') {
    if (order.status === 'cancelled') return none();
    if (final) return none({ alert: 'conflict' });
    return none({ cancel: true, alert: 'cancelled' });
  }
  if (previous && POS_RANK[previous] !== undefined) {
    if (previous === 'Cancelled' || POS_RANK[status] < POS_RANK[previous])
      return none({ alert: 'conflict' });
  }
  // Any progress of an order Xmenu closed without completing it contradicts it
  if (final && order.status !== 'completed') return none({ alert: 'conflict' });

  let target: OrderStatusName | null = null;
  switch (status) {
    case 'Unconfirmed':
      return none({ confirm: true });
    case 'CookingCompleted':
      target = 'ready';
      break;
    case 'OnWay':
      if (order.fulfillment === 'delivery' && courierMode === 'iiko')
        target = 'on_the_way';
      break;
    case 'Delivered':
      if (order.fulfillment === 'delivery' && courierMode === 'iiko')
        target = 'completed';
      break;
    case 'Closed':
      if (order.fulfillment === 'pickup' || courierMode === 'iiko')
        target = 'completed';
      break;
    default:
      // WaitCooking, ReadyForCooking, CookingStarted, Waiting: journal only
      break;
  }
  if (!target) return none();

  const path = PATH[order.fulfillment];
  const from = path.indexOf(order.status);
  const to = path.indexOf(target);
  // Not on the path (problem at the door) or already there or further: nothing to move
  if (from < 0 || from >= to) return none();
  return none({ steps: path.slice(from + 1, to + 1) });
}
