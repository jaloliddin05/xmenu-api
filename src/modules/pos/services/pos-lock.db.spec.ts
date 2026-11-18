import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { isPosLockTimeout, lockPosIntegration } from './pos-lock';

/**
 * The integration lock on a real PostgreSQL (advisory locks need no tables). Runs where DATABASE_URL
 * is set: in CI (the migrated xmenu_ci database) and locally with DATABASE_URL exported.
 */
const url = process.env.DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb('lockPosIntegration (PostgreSQL)', () => {
  let a: PrismaClient;
  let b: PrismaClient;

  beforeAll(() => {
    a = new PrismaClient({ datasourceUrl: url });
    b = new PrismaClient({ datasourceUrl: url });
  });

  afterAll(async () => {
    await a.$disconnect();
    await b.$disconnect();
  });

  /** Holds the lock of `id` in its own transaction until `release` is called. */
  const hold = async (id: string) => {
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const done = a.$transaction(
      async (tx) => {
        await lockPosIntegration(tx, id);
        locked();
        await released;
      },
      { timeout: 20_000 },
    );
    await isLocked;
    return { release, done };
  };

  it('a limited wait gives up with lock_not_available while another transaction holds it', async () => {
    const id = randomUUID();
    const first = await hold(id);
    let error: unknown = null;
    const started = Date.now();
    try {
      await b.$transaction((tx) => lockPosIntegration(tx, id, 300), {
        timeout: 10_000,
      });
    } catch (e) {
      error = e;
    }
    expect(isPosLockTimeout(error)).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    first.release();
    await first.done;
  });

  it('a waiter gets the lock as soon as the holder commits, and other integrations are not blocked', async () => {
    const id = randomUUID();
    const first = await hold(id);
    await b.$transaction((tx) => lockPosIntegration(tx, randomUUID(), 300), {
      timeout: 10_000,
    });
    let releasedAt = 0;
    const waiter = b.$transaction(
      async (tx) => {
        await lockPosIntegration(tx, id, 10_000);
        return Date.now();
      },
      { timeout: 20_000 },
    );
    await new Promise((r) => setTimeout(r, 200));
    releasedAt = Date.now();
    first.release();
    await first.done;
    expect(await waiter).toBeGreaterThanOrEqual(releasedAt);
  });

  it('the wait limit is lifted once the lock is held', async () => {
    const id = randomUUID();
    const rows = await b.$transaction(async (tx) => {
      await lockPosIntegration(tx, id, 300);
      return tx.$queryRaw<{ lock_timeout: string }[]>`SHOW lock_timeout`;
    });
    expect(rows[0].lock_timeout).toBe('0');
  });
});
