import { Logger } from '@nestjs/common';
import * as webPush from 'web-push';
import { FakeRedis } from 'src/infra/redis/redis.fake';
import {
  StaffPushDelivery,
  orderTopic,
  staffPushPayload,
  type StaffPushJob,
} from './staff-push-delivery.service';
import { staffPushText } from './staff-push-texts';
import { BullStaffPushQueue } from './staff-push.queue';
import { StaffPushService } from './staff-push.service';
import { pushResult, type PushSendResult } from './web-push.sender';

/** Web push to the venue staff (docs/API.md, "Web push сотрудникам"). */
const ORG = 'org-1';
const BRANCH = 'branch-1';
const ORDER = '0b6f8a52-3c1d-4e7f-9a2b-5c6d7e8f9a0b';
const PUBLIC_KEY =
  'BHP4ACfXvV8uE98UzA2N97fUQokHUFjIH9YMs-wGIJjhDLfhzTOLV8e4LZsClOcegRgYICe55ZmwcHYN-fHhc4Y';
const PRIVATE_KEY = 'hYZ22uh4yiji8kAy5MF8YSP4EIoJytarY2LHj-o0NwM';

/** What a guest's order holds that must never reach Google, Mozilla or Apple. */
const GUEST = {
  phone: '+998901112233',
  name: 'Aziza Karimova',
  address: 'Amir Temur 15, kv 51',
  item: 'Плов чайханский',
};

beforeAll(() => {
  for (const level of ['log', 'warn', 'error'] as const)
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

const orderRow = (extra: Record<string, unknown> = {}) => ({
  organization_id: ORG,
  branch_id: BRANCH,
  number: 1042,
  status: 'pending_acceptance',
  fulfillment: 'delivery',
  total: 125_000,
  door_problem: null,
  items: [{ quantity: 2 }, { quantity: 3 }],
  // a real query selects none of these; the service must not pass them on even if it got them
  phone: GUEST.phone,
  customer: { name: GUEST.name },
  address_snapshot: { address: GUEST.address },
  ...extra,
});

describe('StaffPushService.notify', () => {
  function setup(order: Record<string, unknown> | null = orderRow()) {
    const redis = new FakeRedis();
    const queue = { enqueue: jest.fn(async () => undefined) };
    const prisma = {
      customer_order: { findUnique: jest.fn(async () => order) },
    };
    const sender = { publicKey: PUBLIC_KEY as string | null, send: jest.fn() };
    const service = new StaffPushService(
      prisma as any,
      redis as any,
      queue,
      sender,
    );
    return { service, queue, sender, redis };
  }

  it('a new delivery order: number, kind, positions and sum; no guest data', async () => {
    const s = setup();
    await s.service.notify(ORDER, 'new_order', 0);
    expect(s.queue.enqueue).toHaveBeenCalledWith(
      {
        organizationId: ORG,
        branchId: BRANCH,
        orderId: ORDER,
        event: 'new_order',
        title: 'Новый заказ №1042',
        body: 'Доставка · 5 позиций · 125 000 сум',
      },
      `staffpush-${ORDER}-new_order-0`,
    );
    const job = JSON.stringify(s.queue.enqueue.mock.calls[0]);
    for (const leak of Object.values(GUEST)) expect(job).not.toContain(leak);
  });

  it('the courier at the door and the courier who cannot deliver', async () => {
    const door = setup(
      orderRow({ status: 'problem_at_door', door_problem: 'no_answer' }),
    );
    await door.service.notify(ORDER, 'at_door', 5);
    expect(door.queue.enqueue.mock.calls[0][0]).toMatchObject({
      title: '№1042: курьер у двери, гость не отвечает',
    });

    const back = setup(orderRow({ status: 'ready' }));
    await back.service.notify(ORDER, 'cannot_deliver', 6);
    expect(back.queue.enqueue.mock.calls[0][0]).toMatchObject({
      title: '№1042: курьер не может доставить',
    });
  });

  it('one event of one order version is sent once', async () => {
    const s = setup();
    await s.service.notify(ORDER, 'new_order', 0);
    await s.service.notify(ORDER, 'new_order', 0);
    expect(s.queue.enqueue).toHaveBeenCalledTimes(1);
    expect(s.redis.keys()).toEqual([`staffpush:${ORDER}-new_order-0`]);
  });

  it('a new episode (at the door again after another trip) is sent again', async () => {
    const s = setup(orderRow({ status: 'problem_at_door' }));
    await s.service.notify(ORDER, 'at_door', 3);
    await s.service.notify(ORDER, 'at_door', 7);
    expect(s.queue.enqueue).toHaveBeenCalledTimes(2);
  });

  it('nothing for an order that already left the status of the event', async () => {
    const s = setup(orderRow({ status: 'accepted' }));
    await s.service.notify(ORDER, 'new_order', 0);
    expect(s.queue.enqueue).not.toHaveBeenCalled();
    expect(s.redis.keys()).toEqual([]);
  });

  it('nothing when push is off on the platform, or the order is gone', async () => {
    const off = setup();
    off.sender.publicKey = null;
    await off.service.notify(ORDER, 'new_order', 0);
    expect(off.queue.enqueue).not.toHaveBeenCalled();

    const gone = setup(null);
    await gone.service.notify(ORDER, 'new_order', 0);
    expect(gone.queue.enqueue).not.toHaveBeenCalled();
  });

  it('never throws: the order transition is not affected', async () => {
    const s = setup();
    s.queue.enqueue.mockRejectedValueOnce(new Error('redis down'));
    await expect(s.service.notify(ORDER, 'new_order', 0)).resolves.toBe(
      undefined,
    );
  });
});

describe('staffPushText', () => {
  const o = {
    number: 7,
    fulfillment: 'pickup' as const,
    itemsCount: 1,
    total: 9000,
    doorProblem: null,
  };
  it.each([
    [1, '1 позиция'],
    [2, '2 позиции'],
    [5, '5 позиций'],
    [11, '11 позиций'],
    [21, '21 позиция'],
    [22, '22 позиции'],
    [112, '112 позиций'],
  ])('%i → %s', (n, text) => {
    expect(staffPushText('new_order', { ...o, itemsCount: n }).body).toContain(
      text,
    );
  });

  it('pickup and a refusal at the door', () => {
    expect(staffPushText('new_order', o).body).toBe(
      'Самовывоз · 1 позиция · 9 000 сум',
    );
    expect(
      staffPushText('at_door', { ...o, doorProblem: 'refused' }).title,
    ).toBe('№7: гость отказался от заказа');
  });
});

describe('StaffPushDelivery', () => {
  const job: StaffPushJob = {
    organizationId: ORG,
    branchId: BRANCH,
    orderId: ORDER,
    event: 'new_order',
    title: 'Новый заказ №1042',
    body: 'Доставка · 5 позиций · 125 000 сум',
  };
  const sub = (id: string) => ({
    id,
    endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
    p256dh: 'p',
    auth: 'a',
  });

  function setup(
    results: Record<string, PushSendResult>,
    branches: Record<string, string[]> = {},
  ) {
    const subs = Object.keys(results).map((id) => ({
      ...sub(id),
      branch_ids: branches[id] ?? [],
    }));
    // The branch condition of the query, evaluated the way the database does
    const follows = (
      s: { branch_ids: string[] },
      or: (
        | { branch_ids: { isEmpty: true } }
        | { branch_ids: { has: string } }
      )[],
    ) =>
      or.some((c) =>
        'isEmpty' in c.branch_ids
          ? s.branch_ids.length === 0
          : s.branch_ids.includes(c.branch_ids.has),
      );
    const prisma = {
      staff_push_subscription: {
        findMany: jest.fn(async ({ where }) =>
          subs
            .filter((s) => !where.id || where.id.in.includes(s.id))
            .filter((s) => follows(s, where.OR))
            .map(({ branch_ids: _b, ...rest }) => rest),
        ),
        updateMany: jest.fn(async () => ({ count: 1 })),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const sender = {
      publicKey: PUBLIC_KEY,
      send: jest.fn(async (target: { endpoint: string }) => {
        const id = target.endpoint.split('/').pop()!;
        return results[id];
      }),
    };
    return {
      delivery: new StaffPushDelivery(prisma as any, sender),
      prisma,
      sender,
    };
  }

  it('sends to the active staff of the venue with TTL and a topic per order', async () => {
    const s = setup({ a: { kind: 'sent' } });
    expect(await s.delivery.deliver(job)).toEqual([]);
    expect(
      s.prisma.staff_push_subscription.findMany.mock.calls[0][0].where,
    ).toEqual({
      organization_id: ORG,
      OR: [{ branch_ids: { isEmpty: true } }, { branch_ids: { has: BRANCH } }],
      user: {
        isActive: true,
        membership: {
          is: {
            organization_id: ORG,
            status: 'active',
            role: { in: ['owner', 'operator'] },
          },
        },
      },
    });
    expect(s.sender.send).toHaveBeenCalledWith(
      sub('a'),
      staffPushPayload(job),
      { ttl: 300, topic: ORDER.replace(/-/g, '') },
    );
    expect(s.prisma.staff_push_subscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { last_success_at: expect.any(Date), failure_count: 0 },
    });
  });

  it('410 or 404 removes the subscription; another error counts; temporary ones come back for a retry', async () => {
    const s = setup({
      gone: { kind: 'gone', status: 410 },
      missing: { kind: 'gone', status: 404 },
      bad: { kind: 'rejected', status: 400 },
      busy: { kind: 'retry', status: 503 },
      ok: { kind: 'sent' },
    });
    expect(await s.delivery.deliver(job)).toEqual(['busy']);
    const deleted = s.prisma.staff_push_subscription.deleteMany.mock.calls.map(
      (c) => c[0].where.id,
    );
    expect(deleted).toEqual(['gone', 'missing']);
    const counted = s.prisma.staff_push_subscription.updateMany.mock.calls
      .filter((c) => c[0].data.failure_count?.increment === 1)
      .map((c) => c[0].where.id);
    expect(counted).toEqual(['bad', 'busy']);
  });

  it('a device gets the orders of the branches it follows; one that chose none gets all', async () => {
    const s = setup(
      {
        all: { kind: 'sent' },
        here: { kind: 'sent' },
        elsewhere: { kind: 'sent' },
        both: { kind: 'sent' },
      },
      {
        here: [BRANCH],
        elsewhere: ['branch-2'],
        both: ['branch-2', BRANCH],
      },
    );
    await s.delivery.deliver(job);
    const sent = s.sender.send.mock.calls.map((c) =>
      c[0].endpoint.split('/').pop(),
    );
    expect(sent).toEqual(['all', 'here', 'both']);
    s.sender.send.mockClear();
    await s.delivery.deliver({ ...job, branchId: 'branch-2' });
    const other = s.sender.send.mock.calls.map((c) =>
      c[0].endpoint.split('/').pop(),
    );
    expect(other).toEqual(['all', 'elsewhere', 'both']);
  });

  it('a retry sends only to the subscriptions that failed', async () => {
    const s = setup({ a: { kind: 'sent' }, b: { kind: 'sent' } });
    await s.delivery.deliver({ ...job, pending: ['b'] });
    expect(s.sender.send).toHaveBeenCalledTimes(1);
    expect(s.sender.send.mock.calls[0][0]).toEqual(sub('b'));
  });

  it('the payload: texts, tag and the dashboard link; no guest data', () => {
    expect(JSON.parse(staffPushPayload(job))).toEqual({
      title: job.title,
      body: job.body,
      tag: `order-${ORDER}`,
      data: { url: `/order?o=${ORDER}`, orderId: ORDER, event: 'new_order' },
    });
  });

  it('the topic fits the push services (base64url, 32 characters at most)', () => {
    expect(orderTopic(ORDER)).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });
});

describe('BullStaffPushQueue.process', () => {
  const fakeJob = (attemptsMade: number) => ({
    data: { orderId: ORDER, organizationId: ORG } as StaffPushJob,
    opts: { attempts: 3 },
    attemptsMade,
    updateData: jest.fn(async () => undefined),
  });

  it('keeps the failed subscriptions in the job and retries', async () => {
    const queue = new BullStaffPushQueue({
      deliver: jest.fn(async () => ['busy']),
    } as any);
    const job = fakeJob(0);
    await expect(queue.process(job as any)).rejects.toThrow();
    expect(job.updateData).toHaveBeenCalledWith({
      ...job.data,
      pending: ['busy'],
    });
  });

  it('the last attempt and a clean run end the job', async () => {
    const last = new BullStaffPushQueue({
      deliver: jest.fn(async () => ['busy']),
    } as any);
    await expect(last.process(fakeJob(2) as any)).resolves.toBeUndefined();
    const clean = new BullStaffPushQueue({
      deliver: jest.fn(async () => []),
    } as any);
    await expect(clean.process(fakeJob(0) as any)).resolves.toBeUndefined();
  });
});

describe('web push request', () => {
  it.each<[number | null, PushSendResult['kind']]>([
    [201, 'sent'],
    [404, 'gone'],
    [410, 'gone'],
    [400, 'rejected'],
    // RFC 8292: 403 = the VAPID token is refused (the platform's keys), not that the subscription is gone;
    // such a subscription is counted and removed by the retention task after repeated failures
    [403, 'rejected'],
    [429, 'retry'],
    [503, 'retry'],
    [null, 'retry'],
  ])('status %s → %s', (status, kind) => {
    expect(pushResult(status).kind).toBe(kind);
  });

  it('the VAPID pair, TTL, urgency and topic make a valid encrypted request', () => {
    const details = webPush.generateRequestDetails(
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        // A browser key pair (RFC 8291 test vector shape): uncompressed P-256 point and 16-byte secret
        keys: {
          p256dh:
            'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
          auth: 'BTBZMqHH6r4Tts7J_aSIgg',
        },
      },
      staffPushPayload({
        organizationId: ORG,
        orderId: ORDER,
        event: 'new_order',
        title: 't',
        body: 'b',
      }),
      {
        TTL: 300,
        urgency: 'high',
        topic: orderTopic(ORDER),
        vapidDetails: {
          subject: 'mailto:ops@xmenu.uz',
          publicKey: PUBLIC_KEY,
          privateKey: PRIVATE_KEY,
        },
      },
    );
    expect(details.headers).toMatchObject({
      TTL: 300,
      Urgency: 'high',
      Topic: orderTopic(ORDER),
      'Content-Encoding': 'aes128gcm',
    });
    expect(String(details.headers.Authorization)).toMatch(/^vapid t=.+, k=/);
  });
});
