import { POS_EVENT_ATTEMPTS, PosOrderQueue } from './pos-order.queue';

describe('PosOrderQueue.event', () => {
  const info = {
    id: 'order-1',
    creation: 'success' as const,
    errorCode: null,
    status: 'Unconfirmed' as const,
    number: '7',
    courierName: null,
  };

  it('queues the webhook order event with retries, one job per event', async () => {
    const add = jest.fn(async () => undefined);
    const queue = new PosOrderQueue({
      enabled: true,
      posOrderQueue: { add },
    } as any);
    await expect(queue.event('int-1', info, 'abc')).resolves.toBe(true);
    expect(add).toHaveBeenCalledWith(
      'event',
      { integrationId: 'int-1', event: info },
      expect.objectContaining({
        jobId: 'pos-event-int-1-abc',
        attempts: POS_EVENT_ATTEMPTS,
        backoff: { type: 'exponential', delay: 5_000 },
      }),
    );
  });

  it('without queues: false, the caller handles it in the request', async () => {
    const queue = new PosOrderQueue({ enabled: false } as any);
    await expect(queue.event('int-1', info, 'abc')).resolves.toBe(false);
  });
});
