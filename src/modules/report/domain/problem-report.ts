/**
 * Report by problems (docs/DELIVERY.md, "Отчёты"), delivery orders only: from the order journal in the period
 * "no answer", refusals by reason, "cannot deliver", returns to the restaurant; cancellations in the period by
 * who cancelled and the reason.
 */
export interface ReportEvent {
  from_status: string | null;
  to_status: string;
  actor: string;
  note: string | null;
}

export interface ReportCancelledOrder {
  cancelled_by: string | null;
  cancel_reason: string | null;
}

export interface ProblemReport {
  counts: {
    noAnswer: number;
    refused: number;
    cannotDeliver: number;
    returned: number;
    cancelled: number;
  };
  refusedReasons: { reason: string; count: number }[];
  cancelReasons: { by: string; reason: string | null; count: number }[];
}

const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count;

const REFUSED_NOTE = 'refused:';

export function problemReport(
  events: readonly ReportEvent[],
  cancelled: readonly ReportCancelledOrder[],
): ProblemReport {
  const counts = {
    noAnswer: 0,
    refused: 0,
    cannotDeliver: 0,
    returned: 0,
    cancelled: cancelled.length,
  };
  const refused = new Map<string, number>();
  for (const e of events) {
    if (e.from_status === e.to_status) continue; // a journal entry without a status change
    if (e.to_status === 'problem_at_door') {
      // The courier's "refused" carries `refused:<reason>`; "no answer" has no note
      if (e.note?.startsWith(REFUSED_NOTE)) {
        counts.refused++;
        const reason = e.note.slice(REFUSED_NOTE.length) || 'other';
        refused.set(reason, (refused.get(reason) ?? 0) + 1);
      } else counts.noAnswer++;
    } else if (
      e.to_status === 'ready' &&
      e.from_status === 'on_the_way' &&
      e.actor === 'courier'
    )
      counts.cannotDeliver++;
    else if (e.to_status === 'returned_to_restaurant') counts.returned++;
  }

  const reasons = new Map<
    string,
    { by: string; reason: string | null; count: number }
  >();
  for (const o of cancelled) {
    const by = o.cancelled_by ?? 'system';
    const reason = o.cancel_reason?.trim() || null;
    const key = JSON.stringify([by, reason]);
    const row = reasons.get(key) ?? { by, reason, count: 0 };
    row.count++;
    reasons.set(key, row);
  }

  return {
    counts,
    refusedReasons: [...refused]
      .map(([reason, count]) => ({ reason, count }))
      .sort(byCount),
    cancelReasons: [...reasons.values()].sort(byCount),
  };
}
