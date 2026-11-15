/**
 * What the operator sees about a courier (docs/DELIVERY.md, "Смена"): not on shift, on shift and free, on
 * shift with N unfinished orders.
 */
export type CourierStateName = 'off_shift' | 'free' | 'busy';

export interface CourierState {
  state: CourierStateName;
  /** Unfinished orders on the courier (accepted, ready, on the way, problem at the door) */
  activeOrders: number;
}

export function courierState(
  onShift: boolean,
  activeOrders: number,
): CourierState {
  if (!onShift) return { state: 'off_shift', activeOrders };
  return { state: activeOrders > 0 ? 'busy' : 'free', activeOrders };
}
