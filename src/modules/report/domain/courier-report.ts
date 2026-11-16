import { ShiftOrder, shiftCash } from 'src/modules/courier/domain/shift-cash';

/**
 * Report by couriers (docs/DELIVERY.md, "Отчёты"): the shifts started in the period, and per courier the
 * deliveries, cash to hand in, cash received and the discrepancy (reconciled shifts), paid by card, shift
 * hours (an open shift counts until now) and the accrued pay (fixed in each order at delivery).
 */
export interface ReportShift {
  id: string;
  courier_id: string;
  courierName: string;
  status: string;
  started_at: Date;
  ended_at: Date | null;
  cash_due: number | null;
  cash_received: number | null;
  cash_discrepancy: number | null;
}

export interface ReportShiftOrder extends ShiftOrder {
  courier_shift_id: string | null;
  courier_pay: number | null;
}

export interface CourierReportTotals {
  shifts: number;
  hours: number;
  deliveries: number;
  cashDue: number;
  cashReceived: number;
  discrepancy: number;
  card: number;
  pay: number;
  /** Ended shifts still waiting for the reconciliation (their cash is in cashDue, not in cashReceived) */
  unreconciledShifts: number;
}

export interface CourierReportRow extends CourierReportTotals {
  courierId: string;
  name: string;
}

const empty = (): CourierReportTotals => ({
  shifts: 0,
  hours: 0,
  deliveries: 0,
  cashDue: 0,
  cashReceived: 0,
  discrepancy: 0,
  card: 0,
  pay: 0,
  unreconciledShifts: 0,
});

const round2 = (n: number) => Math.round(n * 100) / 100;

function add(to: CourierReportTotals, from: CourierReportTotals) {
  for (const k of Object.keys(from) as (keyof CourierReportTotals)[])
    to[k] += from[k];
}

export function courierReport(
  shifts: readonly ReportShift[],
  orders: readonly ReportShiftOrder[],
  now: Date,
): { rows: CourierReportRow[]; total: CourierReportTotals } {
  const ordersOf = new Map<string, ReportShiftOrder[]>();
  for (const o of orders) {
    if (!o.courier_shift_id) continue;
    const list = ordersOf.get(o.courier_shift_id) ?? [];
    list.push(o);
    ordersOf.set(o.courier_shift_id, list);
  }

  const rows = new Map<string, CourierReportRow>();
  for (const s of shifts) {
    const list = ordersOf.get(s.id) ?? [];
    const cash = shiftCash(list);
    const reconciled = s.status === 'reconciled';
    const one: CourierReportTotals = {
      shifts: 1,
      hours:
        ((s.ended_at ?? now).getTime() - s.started_at.getTime()) / 3_600_000,
      deliveries: cash.deliveries,
      cashDue: reconciled ? (s.cash_due ?? cash.due) : cash.due,
      cashReceived: reconciled ? (s.cash_received ?? 0) : 0,
      discrepancy: reconciled ? (s.cash_discrepancy ?? 0) : 0,
      card: cash.card,
      pay: list
        .filter((o) => o.status === 'completed')
        .reduce((sum, o) => sum + (o.courier_pay ?? 0), 0),
      unreconciledShifts: s.status === 'awaiting_reconciliation' ? 1 : 0,
    };
    let row = rows.get(s.courier_id);
    if (!row) {
      row = { courierId: s.courier_id, name: s.courierName, ...empty() };
      rows.set(s.courier_id, row);
    }
    add(row, one);
  }

  const total = empty();
  const list = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const r of list) {
    add(total, r);
    r.hours = round2(r.hours);
  }
  total.hours = round2(total.hours);
  return { rows: list, total };
}
