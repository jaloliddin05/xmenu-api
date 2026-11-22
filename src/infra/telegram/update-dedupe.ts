import type Redis from 'ioredis';

/**
 * Telegram retries a webhook delivery after a timeout or a non-2xx answer. True only for the first delivery of
 * an update_id (SET NX with a lifetime), so an update is handled once. An update without a numeric id cannot be
 * deduplicated and is let through.
 */
export async function claimTelegramUpdate(
  redis: Pick<Redis, 'set'>,
  key: (updateId: number) => string,
  updateId: unknown,
  ttlSeconds: number,
): Promise<boolean> {
  if (typeof updateId !== 'number') return true;
  const fresh = await redis.set(key(updateId), '1', 'EX', ttlSeconds, 'NX');
  return fresh === 'OK';
}
