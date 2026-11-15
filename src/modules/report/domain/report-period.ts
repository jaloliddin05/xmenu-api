import { fieldError } from 'src/infra/validators/validation-errors';

/** The longest report period: a year (a leap year included). */
export const MAX_REPORT_DAYS = 366;

export interface ReportPeriod {
  /** Inclusive */
  from: Date;
  /** Exclusive: [from, to) */
  to: Date;
}

/**
 * The report period: two moments, from inclusive, to exclusive. The dashboard sends the venue's local
 * midnights (it knows the zone); a night shift belongs to the day it started.
 */
export function parsePeriod(from: string, to: string): ReportPeriod {
  const f = new Date(from);
  const t = new Date(to);
  if (Number.isNaN(f.getTime()))
    throw fieldError('from', 'is_iso8601', 'from must be an ISO 8601 moment');
  if (Number.isNaN(t.getTime()))
    throw fieldError('to', 'is_iso8601', 'to must be an ISO 8601 moment');
  if (t <= f) throw fieldError('to', 'after_from', 'to must be after from');
  if (t.getTime() - f.getTime() > MAX_REPORT_DAYS * 86_400_000)
    throw fieldError(
      'to',
      'period_too_long',
      `The period must not be longer than ${MAX_REPORT_DAYS} days`,
    );
  return { from: f, to: t };
}

/** Prisma filter for a timestamp inside the period. */
export const inPeriod = (p: ReportPeriod) => ({ gte: p.from, lt: p.to });
