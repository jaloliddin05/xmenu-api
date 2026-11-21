import { Prisma } from '@prisma/client';
import { AppException } from 'src/infra/errors/app-exception';
import {
  CustomerAnonymizerService,
  ORDER_PII_CLEARED,
} from './customer-anonymizer.service';

function setup(opts: { found?: boolean; active?: number } = {}) {
  const tx = {
    $queryRaw: jest.fn(async () =>
      opts.found === false ? [] : [{ id: 'c1' }],
    ),
    customer: { update: jest.fn(async () => ({})) },
    customer_order: {
      count: jest.fn(async (args: { where: { status?: unknown } }) =>
        args.where.status ? (opts.active ?? 0) : 3,
      ),
      updateMany: jest.fn(async () => ({ count: 3 })),
    },
    customer_address: {
      count: jest.fn(async () => 2),
      deleteMany: jest.fn(async () => ({ count: 2 })),
    },
    customer_session: {
      count: jest.fn(async () => 4),
      deleteMany: jest.fn(async () => ({ count: 4 })),
    },
    customer_auth_event: {
      count: jest.fn(async () => 5),
      updateMany: jest.fn(async () => ({ count: 5 })),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  return { tx, service: new CustomerAnonymizerService(prisma as never) };
}

describe('CustomerAnonymizerService.deleteGuest', () => {
  it('nulls the guest, removes addresses and sessions, anonymizes orders and events', async () => {
    const { tx, service } = setup();
    const r = await service.deleteGuest('t1', 'c1');

    expect(r).toEqual({
      customerId: 'c1',
      dryRun: false,
      addresses: 2,
      sessions: 4,
      authEvents: 5,
      orders: 3,
    });
    const data = (
      tx.customer.update.mock.calls[0] as unknown as [
        { data: Record<string, unknown> },
      ]
    )[0].data;
    expect(data).toMatchObject({
      phone: null,
      name: null,
      telegram_id: null,
      language: null,
    });
    expect(data.deleted_at).toBeInstanceOf(Date);
    expect(tx.customer_address.deleteMany).toHaveBeenCalledWith({
      where: { customer_id: 'c1' },
    });
    expect(tx.customer_session.deleteMany).toHaveBeenCalledWith({
      where: { customer_id: 'c1' },
    });
    const orderData = (
      tx.customer_order.updateMany.mock.calls[0] as unknown as [
        { data: unknown },
      ]
    )[0].data;
    expect(orderData).toBe(ORDER_PII_CLEARED);
  });

  it('clears the personal order columns and nothing that reports use', () => {
    expect(Object.keys(ORDER_PII_CLEARED).sort()).toEqual([
      'address_snapshot',
      'comment',
      'guest_telegram_bot_id',
      'guest_telegram_id',
      'phone',
    ]);
    expect(ORDER_PII_CLEARED.address_snapshot).toBe(Prisma.DbNull);
  });

  it('refuses with has_active_orders while an order is unfinished and writes nothing', async () => {
    const { tx, service } = setup({ active: 2 });
    const err = await service.deleteGuest('t1', 'c1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('has_active_orders');
    expect(tx.customer.update).not.toHaveBeenCalled();
    expect(tx.customer_order.updateMany).not.toHaveBeenCalled();
    expect(tx.customer_address.deleteMany).not.toHaveBeenCalled();
  });

  it('a missing or already deleted guest is not_found', async () => {
    const { service } = setup({ found: false });
    const err = await service.deleteGuest('t1', 'c1').catch((e: unknown) => e);
    expect((err as AppException).code).toBe('not_found');
  });

  it('a dry run reports the counts and writes nothing', async () => {
    const { tx, service } = setup();
    const r = await service.deleteGuest('t1', 'c1', { dryRun: true });
    expect(r).toMatchObject({
      dryRun: true,
      addresses: 2,
      sessions: 4,
      authEvents: 5,
      orders: 3,
    });
    expect(tx.customer.update).not.toHaveBeenCalled();
    expect(tx.customer_order.updateMany).not.toHaveBeenCalled();
    expect(tx.customer_address.deleteMany).not.toHaveBeenCalled();
    expect(tx.customer_session.deleteMany).not.toHaveBeenCalled();
    expect(tx.customer_auth_event.updateMany).not.toHaveBeenCalled();
  });

  it('a second run finds nothing to anonymize (idempotent counts come from the filters)', async () => {
    const { tx, service } = setup();
    tx.customer_order.updateMany.mockResolvedValueOnce({ count: 0 });
    tx.customer_address.deleteMany.mockResolvedValueOnce({ count: 0 });
    tx.customer_session.deleteMany.mockResolvedValueOnce({ count: 0 });
    tx.customer_auth_event.updateMany.mockResolvedValueOnce({ count: 0 });
    const r = await service.deleteGuest('t1', 'c1');
    expect(r).toMatchObject({
      addresses: 0,
      sessions: 0,
      authEvents: 0,
      orders: 0,
    });
    // Only orders that still hold personal data are selected
    const where = (
      tx.customer_order.updateMany.mock.calls[0] as unknown as [
        { where: { OR: unknown[] } },
      ]
    )[0].where;
    expect(where.OR).toHaveLength(5);
  });
});
