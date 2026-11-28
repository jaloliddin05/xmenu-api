import { Prisma } from '@prisma/client';
import { FINAL_STATUSES } from 'src/modules/order/domain/order-state-machine';
import {
  PrivacyRetentionService,
  RETENTION_BATCH,
} from './privacy-retention.service';

const now = new Date('2026-11-22T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

/** `rows(n)` returns n ids for the first call and then nothing, like a table that was cleaned. */
function table(counts: number[]) {
  const queue = [...counts];
  return {
    findMany: jest.fn(async () =>
      Array.from({ length: queue.shift() ?? 0 }, (_, i) => ({ id: `id${i}` })),
    ),
    deleteMany: jest.fn(async (a: { where: { id: { in: unknown[] } } }) => ({
      count: a.where.id.in.length,
    })),
    updateMany: jest.fn(async (a: { where: { id: { in: unknown[] } } }) => ({
      count: a.where.id.in.length,
    })),
  };
}

function setup(c: Partial<Record<string, number[]>> = {}) {
  const prisma = {
    customer_order: table(c.orders ?? []),
    staff_auth_event: table(c.events ?? []),
    staff_session: table(c.sessions ?? []),
    application: table(c.applications ?? []),
    staff_push_subscription: table(c.pushSubscriptions ?? []),
  };
  return { prisma, service: new PrivacyRetentionService(prisma as never) };
}

describe('PrivacyRetentionService.run', () => {
  it('anonymizes only finished, old orders that still hold personal data', async () => {
    const { prisma, service } = setup({ orders: [2] });
    const r = await service.run(now, { ORDER_PII_RETENTION_DAYS: '30' });

    expect(r.orders).toBe(2);
    const where = (
      prisma.customer_order.findMany.mock.calls[0] as unknown as [
        {
          where: {
            created_at: { lt: Date };
            status: { in: string[] };
            OR: unknown[];
          };
        },
      ]
    )[0].where;
    expect(where.created_at.lt.getTime()).toBe(now.getTime() - 30 * DAY);
    expect(where.status.in).toEqual([...FINAL_STATUSES]);
    expect(where.OR).toHaveLength(5);
    expect(
      (
        prisma.customer_order.updateMany.mock.calls[0] as unknown as [
          { data: { address_snapshot: unknown; phone: null } },
        ]
      )[0].data,
    ).toMatchObject({ phone: null, address_snapshot: Prisma.DbNull });
  });

  it('deletes old audit rows, expired sessions and old applications with the fixed boundaries', async () => {
    const { prisma, service } = setup({
      events: [3],
      sessions: [1],
      applications: [4],
    });
    const r = await service.run(now, {});
    expect(r).toMatchObject({
      staffAuthEvents: 3,
      staffSessions: 1,
      applications: 4,
    });
    const lt = (t: { findMany: jest.Mock }, field: string) =>
      (
        t.findMany.mock.calls[0][0] as { where: Record<string, { lt: Date }> }
      ).where[field].lt.getTime();
    expect(lt(prisma.staff_auth_event, 'created_at')).toBe(
      now.getTime() - 90 * DAY,
    );
    expect(lt(prisma.staff_session, 'expires_at')).toBe(
      now.getTime() - 7 * DAY,
    );
    expect(lt(prisma.application, 'created_at')).toBe(
      now.getTime() - 365 * DAY,
    );
  });

  it('deletes dead push subscriptions: 10 failures, or failing for over 30 days without a success', async () => {
    const { prisma, service } = setup({ pushSubscriptions: [3] });
    const r = await service.run(now, {});
    expect(r.pushSubscriptions).toBe(3);
    const cutoff = new Date(now.getTime() - 30 * DAY);
    expect(
      (prisma.staff_push_subscription.findMany.mock.calls[0] as unknown[])[0],
    ).toMatchObject({
      where: {
        OR: [
          { failure_count: { gte: 10 } },
          {
            failure_count: { gt: 0 },
            OR: [
              { last_success_at: { lt: cutoff } },
              { last_success_at: null, created_at: { lt: cutoff } },
            ],
          },
        ],
      },
    });
    expect(prisma.staff_push_subscription.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['id0', 'id1', 'id2'] } },
    });
  });

  it('works in batches until a batch comes back short', async () => {
    const { prisma, service } = setup({
      events: [RETENTION_BATCH, RETENTION_BATCH, 7],
    });
    const r = await service.run(now, {});
    expect(r.staffAuthEvents).toBe(RETENTION_BATCH * 2 + 7);
    expect(prisma.staff_auth_event.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.staff_auth_event.deleteMany).toHaveBeenCalledTimes(3);
  });

  it('a second run on cleaned tables changes nothing', async () => {
    const { prisma, service } = setup();
    const r = await service.run(now, {});
    expect(r).toEqual({
      orders: 0,
      staffAuthEvents: 0,
      staffSessions: 0,
      applications: 0,
      pushSubscriptions: 0,
    });
    expect(prisma.customer_order.updateMany).not.toHaveBeenCalled();
    expect(prisma.staff_auth_event.deleteMany).not.toHaveBeenCalled();
  });

  it('logs one summary line', async () => {
    const { service } = setup({ orders: [1] });
    const log = jest
      .spyOn(
        (service as never as { logger: { log: () => void } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);
    await service.run(now, {});
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toEqual([
      expect.stringContaining('orders anonymized=1'),
    ]);
    expect(log.mock.calls[0][0]).toContain('push_subscription deleted=0');
  });
});
