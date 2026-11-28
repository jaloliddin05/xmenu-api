import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import { LiveEventBus } from './live-event-bus';
import { LiveEventsController } from './live-events.controller';
import { LIVE_HEARTBEAT_MS } from './live-events';
import { LiveStreamService } from './live-stream.service';
import { FakeLiveTransport } from './live-transport.fake';
import { parseSse } from './live-stream.fake';

const ORG = 'org-1';

/** An Express-like request and response that record what the stream writes. */
function fakeHttp() {
  const req = Object.assign(new EventEmitter(), {
    headers: {} as Record<string, string>,
    ip: '10.0.0.1',
    socket: { setTimeout: jest.fn(), setNoDelay: jest.fn() },
  });
  let text = '';
  let ended = false;
  const res = {
    headersSent: false,
    status: jest.fn(() => res),
    setHeader: jest.fn(),
    flushHeaders: jest.fn(() => {
      res.headersSent = true;
    }),
    write: jest.fn((chunk: string) => {
      text += chunk;
      return true;
    }),
    end: jest.fn(() => {
      ended = true;
    }),
  };
  return {
    req: req as unknown as Request,
    res: res as unknown as Response,
    frames: () => parseSse(text),
    ended: () => ended,
    disconnect: () => req.emit('close'),
  };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('LiveStreamService', () => {
  let bus: LiveEventBus;
  let streams: LiveStreamService;

  beforeEach(async () => {
    bus = new LiveEventBus(new FakeLiveTransport());
    await bus.onModuleInit();
    streams = new LiveStreamService(bus);
  });

  afterEach(() => jest.useRealTimers());

  it('closes with `bye token_expired` when the access token expires', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    const h = fakeHttp();
    await streams.serve(h.req, h.res, {
      audience: 'staff',
      orgId: ORG,
      expiresAt: Date.now() + 10_000,
      limits: { user: 'u' },
    });
    jest.advanceTimersByTime(9_999);
    expect(h.ended()).toBe(false);
    jest.advanceTimersByTime(1);
    expect(h.ended()).toBe(true);
    expect(h.frames().pop()).toEqual({
      event: 'bye',
      data: { reason: 'token_expired' },
    });
    expect(streams.gauges.staff).toBe(0);
  });

  it('a heartbeat comment every 25 seconds, and nothing else on a quiet venue', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    const h = fakeHttp();
    await streams.serve(h.req, h.res, {
      audience: 'staff',
      orgId: ORG,
      limits: {},
    });
    jest.advanceTimersByTime(LIVE_HEARTBEAT_MS * 2);
    expect(h.frames().map((f) => f.comment ?? f.event)).toEqual([
      'ready',
      'hb',
      'hb',
    ]);
    h.disconnect();
  });

  it('events arriving while the missed ones are replayed are sent after them, once each', async () => {
    await bus.publish(ORG, {
      type: 'org.changed',
      data: { n: 1 },
      to: ['staff'],
    });
    const last = (await bus.latestId(ORG))!;
    await bus.publish(ORG, {
      type: 'org.changed',
      data: { n: 2 },
      to: ['staff'],
    });
    const h = fakeHttp();
    const replay = bus.replay.bind(bus);
    // a new event lands between subscribing and the end of the replay
    jest.spyOn(bus, 'replay').mockImplementation(async (...args) => {
      await bus.publish(ORG, {
        type: 'org.changed',
        data: { n: 3 },
        to: ['staff'],
      });
      return replay(...args);
    });
    await streams.serve(h.req, h.res, {
      audience: 'staff',
      orgId: ORG,
      lastEventId: last,
      limits: {},
    });
    await flush();
    expect(
      h
        .frames()
        .filter((f) => f.event === 'org.changed')
        .map((f) => f.data?.n),
    ).toEqual([2, 3]);
    h.disconnect();
  });

  it('a disconnect frees the limits and the gauge', async () => {
    const h = fakeHttp();
    await streams.serve(h.req, h.res, {
      audience: 'guest',
      orgId: ORG,
      limits: { guest: 'g' },
    });
    expect(streams.gauges.guest).toBe(1);
    h.disconnect();
    expect(streams.gauges.guest).toBe(0);
    expect(h.ended()).toBe(true);
  });
});

describe('GET /events/guest and /events/public (controller)', () => {
  let bus: LiveEventBus;
  let controller: LiveEventsController;

  beforeEach(async () => {
    bus = new LiveEventBus(new FakeLiveTransport());
    await bus.onModuleInit();
    controller = new LiveEventsController(
      new LiveStreamService(bus),
      {} as never,
    );
  });

  const order = (customer: string, id = 'o-1') => ({
    id,
    organization_id: ORG,
    branch_id: 'b-1',
    customer_id: customer,
    status: 'on_the_way',
    version: 4,
  });

  it('the guest gets the status of own orders only, without the branch', async () => {
    const h = fakeHttp();
    await controller.guest(h.req, h.res, {
      customerId: 'me',
      tenantId: ORG,
      sid: 's-1',
    });
    await bus.order(order('someone-else', 'o-foreign'));
    await bus.order(order('me'));
    await bus.order(order('me'), 'order.attention', { code: 'at_door' });
    await bus.orgChanged(ORG, ['menu']);
    await flush();
    expect(
      h
        .frames()
        .filter((f) => f.event !== 'ready')
        .map((f) => [f.event, f.data]),
    ).toEqual([
      ['order.changed', { orderId: 'o-1', status: 'on_the_way', version: 4 }],
    ]);
    h.disconnect();
  });

  it('the guest stream closes when the guest login ends', async () => {
    const h = fakeHttp();
    await controller.guest(h.req, h.res, {
      customerId: 'me',
      tenantId: ORG,
      sid: 's-2',
    });
    await bus.revoke('guest', 's-2');
    expect(h.ended()).toBe(true);
    expect(h.frames().pop()).toEqual({
      event: 'bye',
      data: { reason: 'revoked' },
    });
  });

  it('the public stream carries only content.changed of its venue', async () => {
    const h = fakeHttp();
    const req = Object.assign(h.req, { tenant: { id: ORG } });
    await controller.publicStream(req, h.res);
    await bus.order(order('me'));
    await bus.publish('org-2', {
      type: 'content.changed',
      data: { scopes: ['menu'] },
      to: ['public'],
    });
    await bus.publish(ORG, {
      type: 'content.changed',
      data: { scopes: ['menu'] },
      to: ['public'],
    });
    await flush();
    expect(
      h
        .frames()
        .filter((f) => f.event !== 'ready')
        .map((f) => [f.event, f.data]),
    ).toEqual([['content.changed', { scopes: ['menu'] }]]);
    h.disconnect();
  });
});
