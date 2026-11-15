/**
 * Cash of a courier's shift (docs/DELIVERY.md, "Наличные"): "to hand in" is the cash of the orders the
 * courier delivered in the shift and took in banknotes; a card paid to the courier is counted apart and not
 * reconciled. Orders not delivered (returned, cancelled, taken off) bring no money.
 */
export interface ShiftOrder {
  status: string;
  payment_method: string;
  cash_collected: string | null;
  total: number;
}

export interface ShiftCash {
  /** Orders the courier delivered in the shift */
  deliveries: number;
  /** Banknotes to hand in */
  due: number;
  /** Paid to the courier by card */
  card: number;
}

export function shiftCash(orders: readonly ShiftOrder[]): ShiftCash {
  const out: ShiftCash = { deliveries: 0, due: 0, card: 0 };
  for (const o of orders) {
    if (o.status !== 'completed') continue;
    out.deliveries++;
    if (o.payment_method !== 'cash') continue;
    if (o.cash_collected === 'card') out.card += o.total;
    else out.due += o.total;
  }
  return out;
}

/** Positive: the operator got more than due; negative: the courier handed in less. */
export const cashDiscrepancy = (received: number, due: number) =>
  received - due;
