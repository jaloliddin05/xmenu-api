import { courierReport } from './courier-report';
import { tableCsv, toCsv } from './csv';
import { externalReport } from './external-report';
import { problemReport } from './problem-report';
import { couriersTable, problemsTable } from './report-table';
import { parsePeriod } from './report-period';

const at = (iso: string) => new Date(iso);

describe('report period', () => {
  it('two moments: from inclusive, to exclusive, up to 366 days', () => {
    expect(
      parsePeriod('2026-11-01T00:00:00+05:00', '2026-12-01T00:00:00+05:00'),
    ).toEqual({
      from: at('2026-10-31T19:00:00Z'),
      to: at('2026-11-30T19:00:00Z'),
    });
    expect(() =>
      parsePeriod('2026-01-01T00:00:00Z', '2027-01-02T00:00:00Z'),
    ).not.toThrow();
  });

  it.each([
    ['2026-11-02T00:00:00Z', '2026-11-01T00:00:00Z', 'to', 'after_from'],
    ['2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 'to', 'after_from'],
    ['2026-01-01T00:00:00Z', '2027-01-02T00:00:01Z', 'to', 'period_too_long'],
    ['not a date', '2026-11-01T00:00:00Z', 'from', 'is_iso8601'],
  ])('%s → %s: 400 validation_error on %s (%s)', (from, to, field, code) => {
    expect(() => parsePeriod(from, to)).toThrow(
      expect.objectContaining({
        code: 'validation_error',
        fields: [expect.objectContaining({ field, code })],
      }),
    );
  });
});

describe('courier report', () => {
  const NOW = at('2026-11-16T20:00:00Z');
  const shift = (o: Record<string, unknown>) => ({
    id: 's1',
    courier_id: 'c1',
    courierName: 'Bekzod',
    status: 'reconciled',
    started_at: at('2026-11-16T08:00:00Z'),
    ended_at: at('2026-11-16T16:00:00Z'),
    cash_due: null,
    cash_received: null,
    cash_discrepancy: null,
    ...o,
  });
  const delivered = (o: Record<string, unknown>) => ({
    courier_shift_id: 's1',
    status: 'completed',
    payment_method: 'cash',
    cash_collected: 'cash',
    total: 100_000,
    courier_pay: 12_000,
    ...o,
  });

  it('per courier: deliveries, due, received, discrepancy, card, hours, pay; totals', () => {
    const report = courierReport(
      [
        shift({
          cash_due: 150_000,
          cash_received: 140_000,
          cash_discrepancy: -10_000,
        }),
        shift({
          id: 's2',
          status: 'awaiting_reconciliation',
          started_at: at('2026-11-15T08:00:00Z'),
          ended_at: at('2026-11-15T12:30:00Z'),
        }),
        shift({
          id: 's3',
          courier_id: 'c2',
          courierName: 'Aziz',
          status: 'open',
          started_at: at('2026-11-16T18:00:00Z'),
          ended_at: null,
        }),
      ],
      [
        delivered({ total: 100_000 }),
        delivered({ total: 50_000 }),
        delivered({ total: 70_000, cash_collected: 'card' }),
        delivered({
          total: 90_000,
          payment_method: 'click',
          cash_collected: null,
        }),
        delivered({ courier_shift_id: 's2', total: 30_000, courier_pay: null }),
        delivered({ courier_shift_id: 's3', total: 40_000 }),
      ],
      NOW,
    );
    expect(report.rows).toEqual([
      {
        courierId: 'c2',
        name: 'Aziz',
        shifts: 1,
        hours: 2,
        deliveries: 1,
        cashDue: 40_000,
        cashReceived: 0,
        discrepancy: 0,
        card: 0,
        pay: 12_000,
        unreconciledShifts: 0,
      },
      {
        courierId: 'c1',
        name: 'Bekzod',
        shifts: 2,
        hours: 12.5,
        deliveries: 5,
        cashDue: 180_000,
        cashReceived: 140_000,
        discrepancy: -10_000,
        card: 70_000,
        pay: 48_000,
        unreconciledShifts: 1,
      },
    ]);
    expect(report.total).toMatchObject({
      shifts: 3,
      hours: 14.5,
      deliveries: 6,
      cashDue: 220_000,
      pay: 60_000,
    });
  });

  it('an empty period gives no rows and zero totals', () => {
    const r = courierReport([], [], NOW);
    expect(r.rows).toEqual([]);
    expect(r.total.deliveries).toBe(0);
  });
});

describe('external services report', () => {
  const handed = (o: Record<string, unknown>) => ({
    external_service: 'Yandex Go',
    external_cost: 20_000,
    external_handed_at: at('2026-11-16T10:00:00Z'),
    payment_method: 'cash',
    external_cash_received: null,
    total: 100_000,
    ...o,
  });

  it('per service (case and spaces ignored, the latest spelling), costs and cash marks', () => {
    const r = externalReport([
      handed({ external_cash_received: true }),
      handed({
        external_service: ' yandex go ',
        external_handed_at: at('2026-11-17T10:00:00Z'),
        external_cash_received: false,
        total: 40_000,
      }),
      handed({ external_service: 'Taxi', external_cost: 15_000 }),
      handed({ payment_method: 'click', external_cost: 5_000 }),
    ]);
    expect(r.rows).toEqual([
      {
        service: 'yandex go',
        orders: 3,
        cost: 45_000,
        cashReceived: 100_000,
        cashNotReceived: 40_000,
        cashUnmarked: 0,
      },
      {
        service: 'Taxi',
        orders: 1,
        cost: 15_000,
        cashReceived: 0,
        cashNotReceived: 0,
        cashUnmarked: 100_000,
      },
    ]);
    expect(r.total).toEqual({
      orders: 4,
      cost: 60_000,
      cashReceived: 100_000,
      cashNotReceived: 40_000,
      cashUnmarked: 100_000,
    });
  });
});

describe('problems report', () => {
  it('no answer, refusals by reason, cannot deliver, returns; journal entries without a change are skipped', () => {
    const r = problemReport(
      [
        {
          from_status: 'on_the_way',
          to_status: 'problem_at_door',
          actor: 'courier',
          note: null,
        },
        {
          from_status: 'on_the_way',
          to_status: 'problem_at_door',
          actor: 'courier',
          note: 'refused:quality',
        },
        {
          from_status: 'on_the_way',
          to_status: 'problem_at_door',
          actor: 'courier',
          note: 'refused:quality',
        },
        {
          from_status: 'on_the_way',
          to_status: 'problem_at_door',
          actor: 'courier',
          note: 'refused:wrong_order',
        },
        {
          from_status: 'on_the_way',
          to_status: 'ready',
          actor: 'courier',
          note: 'cannot_deliver',
        },
        // the courier was disabled: not "cannot deliver"
        {
          from_status: 'on_the_way',
          to_status: 'ready',
          actor: 'system',
          note: 'courier_disabled:x',
        },
        {
          from_status: 'accepted',
          to_status: 'ready',
          actor: 'restaurant',
          note: null,
        },
        {
          from_status: 'problem_at_door',
          to_status: 'returned_to_restaurant',
          actor: 'restaurant',
          note: null,
        },
        {
          from_status: 'ready',
          to_status: 'ready',
          actor: 'restaurant',
          note: 'courier_assigned:x',
        },
      ],
      [
        { cancelled_by: 'restaurant', cancel_reason: 'out_of_stock' },
        { cancelled_by: 'restaurant', cancel_reason: ' out_of_stock ' },
        { cancelled_by: 'system', cancel_reason: 'no_response' },
        { cancelled_by: 'customer', cancel_reason: null },
      ],
    );
    expect(r.counts).toEqual({
      noAnswer: 1,
      refused: 3,
      cannotDeliver: 1,
      returned: 1,
      cancelled: 4,
    });
    expect(r.refusedReasons).toEqual([
      { reason: 'quality', count: 2 },
      { reason: 'wrong_order', count: 1 },
    ]);
    expect(r.cancelReasons[0]).toEqual({
      by: 'restaurant',
      reason: 'out_of_stock',
      count: 2,
    });
    expect(r.cancelReasons).toHaveLength(3);
  });
});

describe('CSV', () => {
  it('BOM, CRLF, quotes doubled, commas and line breaks quoted, numbers as they are', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['x,y', 'say "hi"'],
          ['line\nbreak', -5],
          [null, 1.5],
        ],
      ),
    ).toBe('﻿a,b\r\n"x,y","say ""hi"""\r\n"line\nbreak",-5\r\n,1.5\r\n');
  });

  it('a typed text that a spreadsheet would run as a formula is defused', () => {
    expect(
      toCsv(['s'], [['=HYPERLINK("x")'], ['+1'], ['-2'], ['@SUM(A1)']]),
    ).toBe('﻿s\r\n"\'=HYPERLINK(""x"")"\r\n\'+1\r\n\'-2\r\n\'@SUM(A1)\r\n');
  });

  it('column names in the request language; a total row; every problem kind has a row', () => {
    const couriers = tableCsv(
      couriersTable(courierReport([], [], new Date()), 'en'),
    );
    expect(couriers.split('\r\n')[0]).toBe(
      '﻿Courier,Shifts,Shift hours,Deliveries,Cash to hand in,Received,Discrepancy,Paid by card,Accrued pay,Shifts not reconciled',
    );
    expect(couriers.split('\r\n')[1]).toBe('Total,0,0,0,0,0,0,0,0,0');

    const problems = tableCsv(problemsTable(problemReport([], []), 'ru')).split(
      '\r\n',
    );
    expect(problems.slice(1, -1)).toEqual([
      'Не дозвонился,,0',
      'Отказ гостя,,0',
      'Не могу доставить,,0',
      'Возвращён в ресторан,,0',
      'Отменён,,0',
    ]);
  });
});
