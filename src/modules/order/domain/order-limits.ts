import { Env } from 'src/config/env/env-issues';

export interface CustomerOrderLimits {
  /** Unfinished orders of one guest in one venue */
  active: number;
  /** Orders one guest placed in one venue during the last hour */
  hourly: number;
}

export const DEFAULT_ORDER_LIMITS: CustomerOrderLimits = {
  active: 5,
  hourly: 20,
};
export const HOURLY_WINDOW_SECONDS = 3600;

function positive(raw: string | undefined, def: number): number {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : def;
}

/** ORDER_ACTIVE_LIMIT_PER_CUSTOMER, ORDER_HOURLY_LIMIT_PER_CUSTOMER (platform ceilings; validateEnv checks them). */
export function customerOrderLimits(
  env: Env = process.env,
): CustomerOrderLimits {
  return {
    active: positive(
      env.ORDER_ACTIVE_LIMIT_PER_CUSTOMER,
      DEFAULT_ORDER_LIMITS.active,
    ),
    hourly: positive(
      env.ORDER_HOURLY_LIMIT_PER_CUSTOMER,
      DEFAULT_ORDER_LIMITS.hourly,
    ),
  };
}

/** The venue's own setting (maxActiveOrders) may be stricter than the platform ceiling, never looser. */
export const activeOrderLimit = (venueMax: number, env: Env = process.env) =>
  Math.min(venueMax, customerOrderLimits(env).active);

/** Seconds until the oldest order of the hourly window leaves it (at least 1). */
export function hourlyRetryAfter(oldestAt: Date, nowMs: number): number {
  return Math.max(
    1,
    Math.ceil(
      (oldestAt.getTime() + HOURLY_WINDOW_SECONDS * 1000 - nowMs) / 1000,
    ),
  );
}
