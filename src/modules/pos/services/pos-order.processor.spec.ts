import { PosOrderProcessor } from './pos-order.processor';

describe('PosOrderProcessor', () => {
  it('a webhook order event job applies the event to its order', async () => {
    const statuses = {
      apply: jest.fn(async () => undefined),
      poll: jest.fn(),
    };
    const processor = new PosOrderProcessor(
      {} as any,
      statuses as any,
      { enabled: false } as any,
    );
    const event = {
      id: 'order-1',
      creation: 'success',
      errorCode: null,
      status: 'OnWay',
      number: '7',
      courierName: 'Бекзод',
    };
    await processor.process({
      name: 'event',
      data: { integrationId: 'int-1', event },
    });
    expect(statuses.apply).toHaveBeenCalledWith('int-1', event);
  });

  it('a failing event job fails (BullMQ retries it)', async () => {
    const statuses = {
      apply: jest.fn(async () => Promise.reject(new Error('iiko down'))),
    };
    const processor = new PosOrderProcessor(
      {} as any,
      statuses as any,
      { enabled: false } as any,
    );
    await expect(
      processor.process({
        name: 'event',
        data: { integrationId: 'int-1', event: { id: 'order-1' } },
      }),
    ).rejects.toThrow('iiko down');
  });
});
