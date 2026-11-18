import { Prisma } from '@prisma/client';

/** How long disconnecting waits for a menu import or a stop list refresh of the venue to finish */
export const POS_LOCK_WAIT_MS = 10_000;

type Tx = Pick<Prisma.TransactionClient, '$executeRaw' | '$executeRawUnsafe'>;

/**
 * One integration is changed by one transaction at a time: the menu import, the stop list refresh
 * and disconnecting take this transaction-level advisory lock first, so they never take the row
 * locks of each other's tables in opposite order (deadlock 40P01, audit W15-03). The lock is released
 * with the transaction. With `waitMs` the wait is limited (lock_timeout, error 55P03 after it, see
 * isPosLockTimeout); the limit is lifted again once the lock is held.
 */
export async function lockPosIntegration(
  tx: Tx,
  integrationId: string,
  waitMs?: number,
): Promise<void> {
  const limited = waitMs !== undefined;
  if (limited)
    await tx.$executeRawUnsafe(
      `SET LOCAL lock_timeout = ${Math.max(1, Math.round(waitMs))}`,
    );
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pos:${integrationId}`}, 0))`;
  if (limited) await tx.$executeRawUnsafe('SET LOCAL lock_timeout = 0');
}

/** The lock was not given within `waitMs` (PostgreSQL lock_not_available). */
export function isPosLockTimeout(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const meta = (e.meta ?? {}) as { code?: unknown; message?: unknown };
  const text = typeof meta.message === 'string' ? meta.message : '';
  return (
    meta.code === '55P03' || /lock timeout|55P03/i.test(`${text} ${e.message}`)
  );
}
