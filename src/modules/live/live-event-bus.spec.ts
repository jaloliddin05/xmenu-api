import { LiveEventBus } from './live-event-bus';
import {
  LIVE_BUFFER_MS,
  LIVE_REPLAY_MAX,
  compareStreamIds,
  parseStreamId,
  replayable,
  sseComment,
  sseFrame,
} from './live-events';
import type { LiveEvent } from './live-events';
import { FakeLiveTransport } from './live-transport.fake';

const ORG = 'org-1';
const OTHER = 'org-2';

describe('SSE frames', () => {
  it('writes id, event and one-line JSON data, ending with an empty line', () => {
    expect(
      sseFrame({
        id: '5-0',
        event: 'order.changed',
        data: { orderId: 'o', n: 1 },
      }),
    ).toBe('id: 5-0\nevent: order.changed\ndata: {"orderId":"o","n":1}\n\n');
    expect(sseFrame({ retry: 3000, event: 'ready' })).toBe(
      'retry: 3000\nevent: ready\ndata: {}\n\n',
    );
    expect(sseComment('hb')).toBe(': hb\n\n');
  });

  it('reads stream ids and refuses anything else', () => {
    expect(parseStreamId('1732780000000-3')).toEqual({
      ms: 1732780000000,
      seq: 3,
    });
    for (const bad of ['', 'abc', '12', '1-2-3', '-1-0', undefined, null])
      expect(parseStreamId(bad)).toBeNull();
    expect(compareStreamIds('10-1', '10-0')).toBeGreaterThan(0);
    expect(compareStreamIds('9-5', '10-0')).toBeLessThan(0);
  });

  it('replays only ids inside the buffer', () => {
    const now = 1_000_000_000;
    expect(replayable(`${now - LIVE_BUFFER_MS}-0`, now)).toBe(true);
    expect(replayable(`${now - LIVE_BUFFER_MS - 1}-0`, now)).toBe(false);
    expect(replayable('garbage', now)).toBe(false);
    // an id from the future is a client bug or a reset log: refetch
    expect(replayable(`${now + 120_000}-0`, now)).toBe(false);
  });
});

describe('LiveEventBus', () => {
  let clock: number;
  let transport: FakeLiveTransport;
  let bus: LiveEventBus;

  beforeEach(async () => {
    clock = 1_700_000_000_000;
    transport = new FakeLiveTransport(() => clock);
    bus = new LiveEventBus(transport);
    await bus.onModuleInit();
  });

  const order = (
    extra: Partial<Parameters<LiveEventBus['order']>[0]> = {},
  ) => ({
    id: 'o-1',
    organization_id: ORG,
    branch_id: 'b-1',
    customer_id: 'c-1',
    status: 'accepted',
    version: 3,
    ...extra,
  });

  it('delivers an event to the listeners of its venue only, through the transport', async () => {
    const got: LiveEvent[] = [];
    const other: LiveEvent[] = [];
    bus.subscribe(ORG, (e) => got.push(e));
    bus.subscribe(OTHER, (e) => other.push(e));
    await bus.order(order(), 'order.created');
    expect(got).toHaveLength(1);
    expect(got[0].envelope).toEqual({
      type: 'order.created',
      data: { orderId: 'o-1', status: 'accepted', version: 3, branchId: 'b-1' },
      to: ['staff', 'guest'],
      branchId: 'b-1',
      customerId: 'c-1',
    });
    expect(other).toHaveLength(0);
    expect(bus.counters.events).toBe(1);
  });

  it('carries no guest data: the customer id stays a routing field, not data', async () => {
    await bus.order(order());
    const [stored] = transport.envelopes(ORG) as { data: object }[];
    expect(JSON.stringify(stored.data)).not.toContain('c-1');
  });

  it('time marks go to the staff only', async () => {
    await bus.order(order(), 'order.attention', { code: 'not_picked_up' });
    expect(transport.envelopes(ORG)).toEqual([
      expect.objectContaining({
        type: 'order.attention',
        to: ['staff'],
        data: expect.objectContaining({ code: 'not_picked_up' }),
      }),
    ]);
  });

  it('a second process gets the events published by the first', async () => {
    const second = new LiveEventBus(transport);
    await second.onModuleInit();
    const got: LiveEvent[] = [];
    second.subscribe(ORG, (e) => got.push(e));
    await bus.orgChanged(ORG, ['menu'], 'tab-1');
    expect(got.map((e) => e.envelope)).toEqual([
      {
        type: 'org.changed',
        data: { resources: ['menu'] },
        to: ['staff'],
        origin: 'tab-1',
      },
    ]);
  });

  it('a failing transport is logged, never thrown at the caller', async () => {
    transport.append = () => Promise.reject(new Error('redis down'));
    await expect(bus.order(order())).resolves.toBeUndefined();
    expect(bus.counters.failures).toBe(1);
  });

  it('replays what came after the last id, in order', async () => {
    await bus.order(order({ version: 1 }));
    const first = (await bus.latestId(ORG))!;
    clock += 1000;
    await bus.order(order({ version: 2 }));
    await bus.order(order({ version: 3 }));
    const r = await bus.replay(ORG, first, clock);
    expect(r).not.toBe('resync');
    expect((r as LiveEvent[]).map((e) => e.envelope.data.version)).toEqual([
      2, 3,
    ]);
  });

  it('resync for an id older than the buffer, a garbage id, or too many missed events', async () => {
    await bus.order(order());
    const old = `${clock - LIVE_BUFFER_MS - 1}-0`;
    expect(await bus.replay(ORG, old, clock)).toBe('resync');
    expect(await bus.replay(ORG, 'not-an-id', clock)).toBe('resync');
    const start = (await bus.latestId(ORG))!;
    for (let i = 0; i <= LIVE_REPLAY_MAX; i++)
      await bus.order(order({ version: i }));
    expect(await bus.replay(ORG, start, clock)).toBe('resync');
    expect(bus.counters.resyncs).toBe(3);
  });

  it('a revoked login closes its streams on every process, only that login', async () => {
    const second = new LiveEventBus(transport);
    await second.onModuleInit();
    const closed: string[] = [];
    second.onRevoke('staff', 'sid-a', () => closed.push('staff a'));
    second.onRevoke('staff', 'sid-b', () => closed.push('staff b'));
    second.onRevoke('guest', 'sid-a', () => closed.push('guest a'));
    await bus.revoke('staff', 'sid-a');
    expect(closed).toEqual(['staff a']);
  });

  it('cache invalidation reaches every process', async () => {
    const second = new LiveEventBus(transport);
    await second.onModuleInit();
    const dropped: string[] = [];
    second.onInvalidate((id) => dropped.push(id));
    await bus.invalidate(ORG);
    expect(dropped).toEqual([ORG]);
  });

  it('an unsubscribed listener hears nothing', async () => {
    const got: LiveEvent[] = [];
    const off = bus.subscribe(ORG, (e) => got.push(e));
    off();
    await bus.order(order());
    expect(got).toHaveLength(0);
  });
});
