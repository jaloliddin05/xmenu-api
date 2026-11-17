import { FakeRedis } from 'src/infra/redis/redis.fake';
import { hashWebhookSecret } from 'src/infra/http/webhook-secret';
import { IikoProvider } from '../iiko/iiko.provider';
import { PosWebhookService } from './pos-webhook.service';

const ID = '7d1f4c1e-9a0b-4c1d-8e2f-3a4b5c6d7e8f';
const SECRET = 'f'.repeat(64);

const stopEvent = (correlationId = 'c1') => ({
  eventType: 'StopListUpdate',
  eventTime: '2026-11-17 10:00:00.000',
  organizationId: 'o1',
  correlationId,
  eventInfo: { terminalGroupsStopListsUpdates: [{ id: 'tg1', isFull: false }] },
});

describe('PosWebhookService', () => {
  let row: any;
  let sync: { enqueue: jest.Mock };
  let statuses: { apply: jest.Mock };
  let service: PosWebhookService;

  beforeEach(() => {
    row = {
      id: ID,
      status: 'active',
      external_org_id: 'o1',
      webhook_secret_hash: hashWebhookSecret(SECRET),
    };
    sync = { enqueue: jest.fn(async () => undefined) };
    statuses = { apply: jest.fn(async () => undefined) };
    service = new PosWebhookService(
      {
        pos_integration: {
          findUnique: jest.fn(async ({ where }: any) =>
            where.id === ID ? row : null,
          ),
        },
      } as any,
      new IikoProvider({} as any),
      new FakeRedis() as any,
      sync as any,
      statuses as any,
    );
  });

  it('delivery order events move the order once each; events without an order are skipped', async () => {
    const update = {
      eventType: 'DeliveryOrderUpdate',
      eventTime: '2026-11-17 10:05:00.000',
      organizationId: 'o1',
      correlationId: 'c9',
      eventInfo: {
        id: 'order-1',
        creationStatus: 'Success',
        order: { status: 'CookingCompleted', number: 7 },
      },
    };
    await service.receive(ID, SECRET, [
      update,
      update,
      { ...update, eventType: 'DeliveryOrderError', eventInfo: {} },
    ]);
    expect(statuses.apply).toHaveBeenCalledTimes(1);
    expect(statuses.apply).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ id: 'order-1', status: 'CookingCompleted' }),
    );
  });

  it('a failure while applying an order event: 503, so iiko calls again and the event counts then', async () => {
    const update = {
      eventType: 'DeliveryOrderUpdate',
      organizationId: 'o1',
      eventInfo: { id: 'order-1', order: { status: 'Cancelled' } },
    };
    statuses.apply.mockRejectedValueOnce(new Error('db down'));
    await expect(service.receive(ID, SECRET, [update])).rejects.toMatchObject({
      code: 'unavailable',
    });
    await service.receive(ID, SECRET, [update]);
    expect(statuses.apply).toHaveBeenCalledTimes(2);
  });

  it('a stop list signal queues a refresh', async () => {
    await service.receive(ID, SECRET, [stopEvent()]);
    expect(sync.enqueue).toHaveBeenCalledWith('stop-list', ID);
  });

  it('a "Bearer " prefix is tolerated', async () => {
    await service.receive(ID, `Bearer ${SECRET}`, [stopEvent()]);
    expect(sync.enqueue).toHaveBeenCalledTimes(1);
  });

  it('the same event delivered twice counts once; a new event counts', async () => {
    await service.receive(ID, SECRET, [stopEvent(), stopEvent()]);
    await service.receive(ID, SECRET, [stopEvent()]);
    expect(sync.enqueue).toHaveBeenCalledTimes(1);
    await service.receive(ID, SECRET, [stopEvent('c2')]);
    expect(sync.enqueue).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a wrong secret', ID, 'wrong'],
    ['no secret', ID, undefined],
    ['an unknown integration', '00000000-0000-4000-8000-000000000000', SECRET],
    ['a malformed id', 'mant', SECRET],
  ])('%s: the same 401, nothing queued', async (_, id, secret) => {
    await expect(
      service.receive(id, secret, [stopEvent()]),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(sync.enqueue).not.toHaveBeenCalled();
  });

  it('an integration without a webhook secret (not enabled) refuses', async () => {
    row.webhook_secret_hash = null;
    await expect(service.receive(ID, SECRET, [])).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('events of another iiko organization are skipped', async () => {
    await service.receive(ID, SECRET, [
      { ...stopEvent(), organizationId: 'other' },
    ]);
    expect(sync.enqueue).not.toHaveBeenCalled();
  });

  it('a failure to queue answers 503 and the event is accepted again on the retry', async () => {
    sync.enqueue.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      service.receive(ID, SECRET, [stopEvent()]),
    ).rejects.toMatchObject({
      code: 'unavailable',
    });
    await service.receive(ID, SECRET, [stopEvent()]);
    expect(sync.enqueue).toHaveBeenCalledTimes(2);
  });

  it('delivery order events are accepted and not acted on yet', async () => {
    await service.receive(ID, SECRET, [
      { ...stopEvent(), eventType: 'DeliveryOrderUpdate', eventInfo: {} },
    ]);
    expect(sync.enqueue).not.toHaveBeenCalled();
  });
});
