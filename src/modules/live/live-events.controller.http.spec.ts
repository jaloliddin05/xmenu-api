import { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import request from 'supertest';
import { createHttpApp, staffToken } from 'src/infra/testing/http-app.fake';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { TenantService } from 'src/modules/tenant/tenant.service';
import { LiveEventBus } from './live-event-bus';
import { LiveEventsController } from './live-events.controller';
import { LiveStreamService, LIVE_LIMITS } from './live-stream.service';
import { LIVE_BUFFER_MS } from './live-events';
import { LIVE_TRANSPORT } from './live-transport';
import { FakeLiveTransport } from './live-transport.fake';
import { openStream } from './live-stream.fake';

/** GET /events/staff (docs/API.md, "События (SSE)"): the venue stream of the dashboard. */
const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const BRANCH = '33333333-3333-4333-8333-333333333333';
const OTHER_BRANCH = '44444444-4444-4444-8444-444444444444';

describe('GET /events/staff', () => {
  let app: INestApplication;
  let server: Server;
  let bus: LiveEventBus;
  const revoked = new Set<string>();
  const auth = (user = 'owner', sid?: string) => ({
    Authorization: `Bearer ${staffToken(user, undefined, sid)}`,
  });

  beforeAll(async () => {
    const transport = new FakeLiveTransport();
    app = await createHttpApp(
      {
        controllers: [LiveEventsController],
        providers: [
          LiveStreamService,
          LiveEventBus,
          { provide: LIVE_TRANSPORT, useValue: transport },
          // the guest and public streams of the same controller resolve the venue (not used by these specs)
          { provide: TenantService, useValue: { resolve: jest.fn() } },
          {
            provide: PrismaService,
            useValue: {
              branch: {
                findFirst: jest.fn(async ({ where }) =>
                  where.id === BRANCH && where.organization_id === ORG
                    ? { id: BRANCH }
                    : null,
                ),
              },
            },
          },
        ],
      },
      [
        { id: 'owner', organization: { id: ORG } },
        { id: 'operator', role: 'operator', organization: { id: ORG } },
        { id: 'stranger', organization: { id: OTHER_ORG } },
      ],
      revoked,
    );
    server = app.getHttpServer() as Server;
    bus = app.get(LiveEventBus);
  });

  afterAll(() => app.close());

  const order = (extra: Record<string, unknown> = {}) => ({
    id: 'o-1',
    organization_id: ORG,
    branch_id: BRANCH,
    customer_id: 'c-1',
    status: 'pending_acceptance',
    version: 1,
    ...extra,
  });

  it('without a token 401, with an ended login 401', async () => {
    expect((await request(server).get('/events/staff')).status).toBe(401);
    revoked.add('sid-ended');
    const res = await request(server)
      .get('/events/staff')
      .set(auth('owner', 'sid-ended'));
    expect([res.status, res.body.code]).toEqual([401, 'unauthorized']);
  });

  it('a branch of another venue is 404, a malformed one 400', async () => {
    const foreign = await request(server)
      .get(`/events/staff?branchId=${OTHER_BRANCH}`)
      .set(auth());
    expect([foreign.status, foreign.body.code]).toEqual([404, 'not_found']);
    const bad = await request(server)
      .get('/events/staff?branchId=x')
      .set(auth());
    expect(bad.status).toBe(400);
  });

  it('opens with headers that keep proxies from buffering, then `ready` with an id', async () => {
    const s = await openStream(server, '/events/staff', auth('operator'));
    expect(s.status).toBe(200);
    const [ready] = await s.waitFor((f) => f.some((x) => x.event === 'ready'));
    expect(ready).toEqual(
      expect.objectContaining({
        event: 'ready',
        id: expect.stringMatching(/^\d+-\d+$/),
      }),
    );
    expect(s.body().startsWith('retry: 3000\n\n')).toBe(true);
    s.close();
  });

  it('sends the events of its venue only, as thin signals', async () => {
    const s = await openStream(server, '/events/staff', auth());
    await s.waitFor((f) => f.some((x) => x.event === 'ready'));
    await bus.order({ ...order(), organization_id: OTHER_ORG });
    await bus.order(order(), 'order.created');
    const frames = await s.waitFor((f) =>
      f.some((x) => x.event === 'order.created'),
    );
    const events = frames.filter((f) => f.event?.startsWith('order.'));
    expect(events).toEqual([
      {
        id: expect.any(String),
        event: 'order.created',
        data: {
          orderId: 'o-1',
          status: 'pending_acceptance',
          version: 1,
          branchId: BRANCH,
        },
      },
    ]);
    s.close();
  });

  it('the owner of another venue gets nothing of this venue', async () => {
    const s = await openStream(server, '/events/staff', auth('stranger'));
    await s.waitFor((f) => f.some((x) => x.event === 'ready'));
    await bus.order(order(), 'order.created');
    await bus.orgChanged(ORG, ['menu']);
    await new Promise((r) => setTimeout(r, 50));
    expect(s.frames().filter((f) => f.event !== 'ready')).toEqual([]);
    s.close();
  });

  it('?branchId: events of other branches are dropped, venue-wide events pass', async () => {
    const s = await openStream(
      server,
      `/events/staff?branchId=${BRANCH}`,
      auth(),
    );
    await s.waitFor((f) => f.some((x) => x.event === 'ready'));
    await bus.order(order({ id: 'o-other', branch_id: OTHER_BRANCH }));
    await bus.order(order({ id: 'o-mine' }));
    await bus.orgChanged(ORG, ['menu'], 'tab-7');
    const frames = await s.waitFor((f) =>
      f.some((x) => x.event === 'org.changed'),
    );
    expect(
      frames
        .filter((f) => f.event && f.event !== 'ready')
        .map((f) => [f.event, f.data]),
    ).toEqual([
      ['order.changed', expect.objectContaining({ orderId: 'o-mine' })],
      ['org.changed', { resources: ['menu'], origin: 'tab-7' }],
    ]);
    s.close();
  });

  it('an ended login closes its stream at once with `bye revoked`; another login stays open', async () => {
    const mine = await openStream(
      server,
      '/events/staff',
      auth('owner', 'sid-live'),
    );
    const other = await openStream(
      server,
      '/events/staff',
      auth('owner', 'sid-other'),
    );
    await mine.waitFor((f) => f.some((x) => x.event === 'ready'));
    await other.waitFor((f) => f.some((x) => x.event === 'ready'));
    await bus.revoke('staff', 'sid-live');
    const frames = await mine.waitFor(() => mine.ended());
    expect(frames[frames.length - 1]).toEqual({
      event: 'bye',
      data: { reason: 'revoked' },
    });
    expect(other.ended()).toBe(false);
    other.close();
  });

  it('Last-Event-ID: the missed events come first, then `ready`', async () => {
    await bus.order(order({ version: 1 }));
    const last = (await bus.latestId(ORG))!;
    await bus.order(order({ version: 2 }));
    await bus.order(order({ version: 3 }));
    const s = await openStream(server, '/events/staff', {
      ...auth(),
      'Last-Event-ID': last,
    });
    const frames = await s.waitFor((f) => f.some((x) => x.event === 'ready'));
    expect(
      frames
        .filter((f) => f.event === 'order.changed')
        .map((f) => f.data?.version),
    ).toEqual([2, 3]);
    s.close();
  });

  it('Last-Event-ID older than the buffer: `resync` instead of a replay', async () => {
    const s = await openStream(server, '/events/staff', {
      ...auth(),
      'Last-Event-ID': `${Date.now() - LIVE_BUFFER_MS - 1000}-0`,
    });
    const frames = await s.waitFor((f) => f.some((x) => x.event === 'resync'));
    expect(frames.some((f) => f.event === 'ready')).toBe(false);
    s.close();
  });

  it(`at most ${LIVE_LIMITS.user} streams per user: the next one is 429 with retryAfter`, async () => {
    const open: Awaited<ReturnType<typeof openStream>>[] = [];
    for (let i = 0; i < LIVE_LIMITS.user; i++) {
      const s = await openStream(
        server,
        '/events/staff',
        auth('operator', `sid-l${i}`),
      );
      await s.waitFor((f) => f.some((x) => x.event === 'ready'));
      open.push(s);
    }
    const res = await request(server)
      .get('/events/staff')
      .set(auth('operator', 'sid-l-extra'));
    expect([res.status, res.body.code, typeof res.body.retryAfter]).toEqual([
      429,
      'rate_limited',
      'number',
    ]);
    for (const s of open) s.close();
    // a closed stream frees its place
    await new Promise((r) => setTimeout(r, 50));
    const again = await openStream(
      server,
      '/events/staff',
      auth('operator', 'sid-l-again'),
    );
    expect(again.status).toBe(200);
    again.close();
  });

  it('GET /events/ping: two pings two seconds apart, then the end, without a token', async () => {
    const started = Date.now();
    const s = await openStream(server, '/events/ping');
    const frames = await s.waitFor(() => s.ended(), 5000);
    expect(frames).toEqual([{ comment: 'ping' }, { comment: 'ping' }]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
  });
});
