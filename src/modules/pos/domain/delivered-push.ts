import type { PosDeliveryStatus } from '../provider/pos-provider';

export type DeliveredStep = 'OnWay' | 'Delivered';

/**
 * What iiko still needs after an own courier of the venue delivered (docs/IIKO.md, decision 7). iiko
 * sets a delivery status from outside only among Waiting, OnWay and Delivered, and only to a
 * neighbouring one ("Can be only switched between these three statuses"); so the steps depend on the
 * status iiko has now:
 * - Waiting (cooked, waits for the courier): OnWay, then Delivered;
 * - OnWay: Delivered;
 * - Delivered, Closed: nothing left;
 * - still cooking, not confirmed, cancelled or unknown: iiko would refuse, nothing is sent blindly.
 */
export function deliveredPushSteps(
  current: PosDeliveryStatus | null,
): DeliveredStep[] | 'blocked' {
  switch (current) {
    case 'Waiting':
      return ['OnWay', 'Delivered'];
    case 'OnWay':
      return ['Delivered'];
    case 'Delivered':
    case 'Closed':
      return [];
    default:
      return 'blocked';
  }
}
