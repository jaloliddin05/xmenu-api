import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { OrderTransitionService } from '../services/order-transition.service';
import { PaymentFailedExpiryService } from './payment-failed-expiry.service';

/**
 * The hourly payment_failed scan on a real PostgreSQL: the age is taken from the last journal entry into
 * payment_failed, so an order that failed again recently waits, and a guest who retried or cancelled is left alone.
 * Runs where DATABASE_URL points at an xmenu_* database.
 */
const url = /\/xmenu_[^/?]*(\?.*)?$/.test(process.env.DATABASE_URL ?? '')
  ? process.env.DATABASE_URL
  : undefined;
const describeDb = url ? describe : describe.skip;

const HOUR = 3600_000;

describeDb('payment_failed expiry (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let service: PaymentFailedExpiryService;
  let orgId: string;
  let branchId: string;
  let customerId: string;
  let number = 1;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    const transitions = new OrderTransitionService(
      prisma as any,
      {} as any,
      { refreshMessage: jest.fn(async () => undefined) } as any,
      { notifyStatus: jest.fn(async () => undefined) } as any,
      {} as any,
      { notify: jest.fn(async () => undefined) } as any,
    );
    jest
      .spyOn(transitions, 'dispatchEffects')
      .mockImplementation(() => undefined);
    service = new PaymentFailedExpiryService(prisma as any, transitions);

    const org = await prisma.organization.create({
      data: { name: `pf-${randomUUID().slice(0, 8)}` },
    });
    orgId = org.id;
    branchId = (
      await prisma.branch.create({
        data: {
          organization_id: orgId,
          title: 'B',
          address: 'A',
          latitude: 41.3,
          longitude: 69.2,
        },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: { organization_id: orgId, phone: '+998900000003' },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  /** An order whose journal says it got into `status` hoursAgo hours ago. */
  async function order(
    status: 'payment_failed' | 'awaiting_payment',
    hoursAgo: number,
  ) {
    const now = Date.now();
    return prisma.customer_order.create({
      data: {
        number: number++,
        organization_id: orgId,
        customer_id: customerId,
        branch_id: branchId,
        status,
        fulfillment: 'pickup',
        idempotency_key: randomUUID(),
        request_hash: 'h',
        phone: '+998900000003',
        payment_method: 'click',
        payment_status: status === 'payment_failed' ? 'failed' : 'pending',
        currency: 'UZS',
        subtotal: 1000,
        total: 1000,
        events: {
          create: [
            {
              to_status: 'awaiting_payment',
              actor: 'customer',
              created_at: new Date(now - (hoursAgo + 1) * HOUR),
            },
            {
              from_status: 'awaiting_payment',
              to_status: 'payment_failed',
              actor: 'system',
              created_at: new Date(now - hoursAgo * HOUR),
            },
          ],
        },
      },
    });
  }

  const statusOf = async (id: string) =>
    (await prisma.customer_order.findUniqueOrThrow({ where: { id } })).status;

  it('cancels an order left in payment_failed longer than the TTL and leaves a fresh one', async () => {
    const old = await order('payment_failed', 25);
    const fresh = await order('payment_failed', 2);

    await service.run(new Date(), { PAYMENT_FAILED_TTL_HOURS: '24' });

    const cancelled = await prisma.customer_order.findUniqueOrThrow({
      where: { id: old.id },
    });
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      cancelled_by: 'system',
      cancel_reason: 'payment_expired',
    });
    expect(await statusOf(fresh.id)).toBe('payment_failed');
  });

  it('a second run does nothing more (idempotent)', async () => {
    const old = await order('payment_failed', 30);
    await service.run(new Date(), {});
    expect(await service.run(new Date(), {})).toBe(0);
    expect(await statusOf(old.id)).toBe('cancelled');
  });

  it('an order that failed long ago but again recently waits for the TTL from the last failure', async () => {
    const o = await order('payment_failed', 30);
    await prisma.order_status_event.create({
      data: {
        order_id: o.id,
        from_status: 'awaiting_payment',
        to_status: 'payment_failed',
        actor: 'system',
        created_at: new Date(Date.now() - HOUR),
      },
    });
    await service.run(new Date(), {});
    expect(await statusOf(o.id)).toBe('payment_failed');
  });

  it('an old order the guest is paying again (awaiting_payment) is not touched', async () => {
    const o = await order('awaiting_payment', 30);
    await service.run(new Date(), {});
    expect(await statusOf(o.id)).toBe('awaiting_payment');
  });
});
