const DAY_MS = 24 * 60 * 60 * 1000;

/** Defaults when the variable is empty or not a positive integer. */
export const ORDER_PII_RETENTION_DEFAULT_DAYS = 365;
export const APPLICATION_RETENTION_DEFAULT_DAYS = 365;
/** Fixed periods (docs/PRIVACY-FACTS.md). */
export const STAFF_AUTH_EVENT_RETENTION_DAYS = 90;
export const STAFF_SESSION_EXPIRED_GRACE_DAYS = 7;
/** Web push subscriptions: this many failed sends in a row, or this many days without a success while failing */
export const PUSH_SUBSCRIPTION_DEAD_FAILURES = 10;
export const PUSH_SUBSCRIPTION_STALE_DAYS = 30;

export interface RetentionCutoffs {
  /** Orders created before this lose the guest's personal data */
  orders: Date;
  /** staff_auth_event rows created before this are deleted */
  staffAuthEvents: Date;
  /** staff_session rows that expired before this are deleted */
  staffSessions: Date;
  /** Landing applications created before this are deleted */
  applications: Date;
  /** Push subscriptions that keep failing and have had no success since this are deleted */
  pushSubscriptions: Date;
}

function days(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** A record is kept for the period; one exactly N days old is still kept (the cutoff is exclusive). */
export function retentionCutoffs(
  now: Date,
  env: NodeJS.ProcessEnv = process.env,
): RetentionCutoffs {
  const before = (d: number) => new Date(now.getTime() - d * DAY_MS);
  return {
    orders: before(
      days(env.ORDER_PII_RETENTION_DAYS, ORDER_PII_RETENTION_DEFAULT_DAYS),
    ),
    staffAuthEvents: before(STAFF_AUTH_EVENT_RETENTION_DAYS),
    staffSessions: before(STAFF_SESSION_EXPIRED_GRACE_DAYS),
    applications: before(
      days(env.APPLICATION_RETENTION_DAYS, APPLICATION_RETENTION_DEFAULT_DAYS),
    ),
    pushSubscriptions: before(PUSH_SUBSCRIPTION_STALE_DAYS),
  };
}
