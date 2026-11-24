import { PAYMENT_EXPIRED_REASON } from '../domain/order-state-machine';
import { buildCustomerText } from '../notifications/order-messages';
import {
  InvalidTransitionError,
  OrderTransitionService,
} from '../services/order-transition.service';
import {
  PaymentFailedExpiryService,
  paymentFailedTtlMs,
} from './payment-failed-expiry.service';

const NOW = new Date('2026-11-22T12:00:00Z');
const HOUR = 3600_000;

function setup(ids: string[]) {
  const prisma = {
    customer_order: {
      findMany: jest.fn(async () => ids.map((id) => ({ id }))),
    },
  };
  const transitions = { transition: jest.fn(async () => ({})) };
  const service = new PaymentFailedExpiryService(
    prisma as any,
    transitions as any,
  );
  return { prisma, transitions, service };
}

describe('PaymentFailedExpiryService', () => {
  it('looks for orders whose last entry into payment_failed is older than PAYMENT_FAILED_TTL_HOURS', async () => {
    const { prisma, service } = setup([]);
    await service.run(NOW, { PAYMENT_FAILED_TTL_HOURS: '6' });

    const { where } = (prisma.customer_order.findMany.mock.calls[0] as any)[0];
    expect(where).toEqual({
      status: 'payment_failed',
      events: {
        none: {
          to_status: 'payment_failed',
          created_at: { gte: new Date(NOW.getTime() - 6 * HOUR) },
        },
      },
    });
  });

  it('cancels each found order as the system, only from payment_failed, with the payment_expired reason', async () => {
    const { transitions, service } = setup(['o1', 'o2']);
    expect(await service.run(NOW, {})).toBe(2);
    expect(transitions.transition).toHaveBeenCalledWith({
      orderId: 'o1',
      to: 'cancelled',
      actor: 'system',
      expectedFrom: 'payment_failed',
      reason: PAYMENT_EXPIRED_REASON,
      note: PAYMENT_EXPIRED_REASON,
    });
  });

  it('a guest who cancelled or paid again in the meantime is skipped without an error', async () => {
    const { transitions, service } = setup(['o1', 'o2']);
    transitions.transition.mockRejectedValueOnce(
      new InvalidTransitionError(
        'awaiting_payment',
        'cancelled',
        'not_allowed',
      ),
    );
    expect(await service.run(NOW, {})).toBe(1);
    expect(transitions.transition).toHaveBeenCalledTimes(2);
  });

  it('TTL is 24 hours by default and ignores values that are not a positive number', () => {
    expect(paymentFailedTtlMs({})).toBe(24 * HOUR);
    expect(paymentFailedTtlMs({ PAYMENT_FAILED_TTL_HOURS: '0' })).toBe(
      24 * HOUR,
    );
    expect(paymentFailedTtlMs({ PAYMENT_FAILED_TTL_HOURS: '48' })).toBe(
      48 * HOUR,
    );
  });

  it('the guest gets no message about this cancel (the timeline shows it)', () => {
    const order = {
      number: 1001,
      status: 'cancelled',
      payment_method: 'click',
      payment_status: 'failed',
      cancelled_by: 'system',
    } as any;
    expect(
      buildCustomerText(
        { ...order, cancel_reason: PAYMENT_EXPIRED_REASON },
        'payment_failed',
      ),
    ).toBeNull();
    // Any other system cancel still tells the guest
    expect(
      buildCustomerText(
        { ...order, cancel_reason: 'no_response' },
        'pending_acceptance',
      ),
    ).not.toBeNull();
  });
});

describe('OrderTransitionService expectedFrom', () => {
  function transitions(status: string) {
    const row = {
      id: 'o1',
      status,
      fulfillment: 'pickup',
      version: 0,
      courier_id: null,
      payment_status: 'failed',
      payment_method: 'click',
    };
    const tx = {
      customer_order: {
        findUnique: jest.fn(async () => ({ ...row })),
        findUniqueOrThrow: jest.fn(async () => ({ ...row })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      order_status_event: { create: jest.fn(async () => undefined) },
      pos_order: { count: jest.fn(async () => 0) },
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const service = new OrderTransitionService(
      prisma as any,
      {} as any,
      { refreshMessage: jest.fn(async () => undefined) } as any,
      { notifyStatus: jest.fn(async () => undefined) } as any,
      {} as any,
      { notify: jest.fn(async () => undefined) } as any,
    );
    jest.spyOn(service, 'dispatchEffects').mockImplementation(() => undefined);
    return { service, tx };
  }

  it('refuses when the order left the expected status, although the target is reachable from the new one', async () => {
    // awaiting_payment -> cancelled is allowed for the system; the guest retried payment after the scan read the row
    const { service, tx } = transitions('awaiting_payment');
    await expect(
      service.transition({
        orderId: 'o1',
        to: 'cancelled',
        actor: 'system',
        expectedFrom: 'payment_failed',
      }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(tx.customer_order.updateMany).not.toHaveBeenCalled();
  });

  it('goes through from the expected status', async () => {
    const { service, tx } = transitions('payment_failed');
    await service.transition({
      orderId: 'o1',
      to: 'cancelled',
      actor: 'system',
      expectedFrom: 'payment_failed',
      reason: PAYMENT_EXPIRED_REASON,
    });
    expect(tx.customer_order.updateMany).toHaveBeenCalledTimes(1);
  });
});
