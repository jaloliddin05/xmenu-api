import { paidAtDoor } from 'src/modules/order/domain/delivery-payment';

/**
 * Report by external services (docs/DELIVERY.md, "Отчёты"): orders handed over in the period and what the
 * venue paid, per service; for cash orders whether the venue got the money (sums of the order totals).
 * Services are told apart ignoring case and spaces around; the row shows the latest spelling.
 */
export interface ReportExternalOrder {
  external_service: string | null;
  external_cost: number | null;
  external_handed_at: Date | null;
  payment_method: string;
  external_cash_received: boolean | null;
  total: number;
}

export interface ExternalReportTotals {
  orders: number;
  cost: number;
  cashReceived: number;
  cashNotReceived: number;
  /** Cash orders the operator has not marked yet */
  cashUnmarked: number;
}

export interface ExternalReportRow extends ExternalReportTotals {
  service: string;
}

const empty = (): ExternalReportTotals => ({
  orders: 0,
  cost: 0,
  cashReceived: 0,
  cashNotReceived: 0,
  cashUnmarked: 0,
});

export function externalReport(orders: readonly ReportExternalOrder[]): {
  rows: ExternalReportRow[];
  total: ExternalReportTotals;
} {
  const rows = new Map<string, { row: ExternalReportRow; at: number }>();
  const total = empty();
  for (const o of orders) {
    const name = (o.external_service ?? '').trim();
    const key = name.toLowerCase();
    const at = o.external_handed_at?.getTime() ?? 0;
    let entry = rows.get(key);
    if (!entry) {
      entry = { row: { service: name, ...empty() }, at };
      rows.set(key, entry);
    } else if (at > entry.at) {
      entry.row.service = name;
      entry.at = at;
    }
    const one = empty();
    one.orders = 1;
    one.cost = o.external_cost ?? 0;
    if (paidAtDoor(o.payment_method)) {
      if (o.external_cash_received === true) one.cashReceived = o.total;
      else if (o.external_cash_received === false)
        one.cashNotReceived = o.total;
      else one.cashUnmarked = o.total;
    }
    for (const k of Object.keys(one) as (keyof ExternalReportTotals)[]) {
      entry.row[k] += one[k];
      total[k] += one[k];
    }
  }
  return {
    rows: [...rows.values()]
      .map((e) => e.row)
      .sort((a, b) => b.cost - a.cost || a.service.localeCompare(b.service)),
    total,
  };
}
