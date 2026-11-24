import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp, staffToken } from 'src/infra/testing/http-app.fake';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { PushController } from './push.controller';
import { PushSubscriptionService } from './push-subscription.service';
import { WEB_PUSH_SENDER } from './web-push.sender';

/** GET /push/public-key, POST/DELETE /push/subscriptions (docs/API.md, "Web push сотрудникам"). */
const ORG = '11111111-1111-4111-8111-111111111111';
const PUBLIC_KEY =
  'BHP4ACfXvV8uE98UzA2N97fUQokHUFjIH9YMs-wGIJjhDLfhzTOLV8e4LZsClOcegRgYICe55ZmwcHYN-fHhc4Y';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/dpH5lCsTSSM:APA91bH';
const KEYS = {
  p256dh:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
};

const BRANCH_A = '22222222-2222-4222-8222-222222222222';
const BRANCH_B = '33333333-3333-4333-8333-333333333333';
const FOREIGN_BRANCH = '44444444-4444-4444-8444-444444444444';
const OWN_BRANCHES = [BRANCH_A, BRANCH_B];

type Row = Record<string, any>;

describe('web push routes', () => {
  let app: INestApplication;
  let rows: Row[];
  const sender = { publicKey: PUBLIC_KEY as string | null, send: jest.fn() };

  beforeAll(async () => {
    const prisma = {
      branch: {
        count: jest.fn(
          async ({ where }) =>
            where.id.in.filter((id: string) => OWN_BRANCHES.includes(id))
              .length,
        ),
      },
      staff_push_subscription: {
        upsert: jest.fn(async ({ where, create, update }) => {
          const found = rows.find((r) => r.endpoint === where.endpoint);
          if (found) Object.assign(found, update);
          else rows.push({ ...create });
        }),
        deleteMany: jest.fn(async ({ where }) => {
          const before = rows.length;
          rows = rows.filter(
            (r) => !Object.entries(where).every(([k, v]) => r[k] === v),
          );
          return { count: before - rows.length };
        }),
      },
    };
    app = await createHttpApp(
      {
        controllers: [PushController],
        providers: [
          PushSubscriptionService,
          { provide: PrismaService, useValue: prisma },
          { provide: WEB_PUSH_SENDER, useValue: sender },
        ],
      },
      [
        { id: 'owner', role: 'owner', organization: { id: ORG } },
        { id: 'operator', role: 'operator', organization: { id: ORG } },
      ],
    );
  });
  afterAll(() => app.close());
  beforeEach(() => {
    rows = [];
    sender.publicKey = PUBLIC_KEY;
  });

  const as = (who: string) => `Bearer ${staffToken(who)}`;
  const subscribe = (who: string, body: object) =>
    request(app.getHttpServer())
      .post('/push/subscriptions')
      .set('Authorization', as(who))
      .send(body);
  const unsubscribe = (who: string, endpoint: string) =>
    request(app.getHttpServer())
      .delete('/push/subscriptions')
      .set('Authorization', as(who))
      .send({ endpoint });

  it('the public key for the browser', async () => {
    const res = await request(app.getHttpServer())
      .get('/push/public-key')
      .set('Authorization', as('operator'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ publicKey: PUBLIC_KEY });
  });

  it('no VAPID keys on the platform: 503 platform_misconfigured, feature web_push, no details', async () => {
    sender.publicKey = null;
    const res = await request(app.getHttpServer())
      .get('/push/public-key')
      .set('Authorization', as('owner'));
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code: 'platform_misconfigured',
      details: { feature: 'web_push' },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/VAPID|WEB_PUSH/);
  });

  it('an operator subscribes; the same endpoint again updates the row', async () => {
    await subscribe('operator', {
      endpoint: ENDPOINT,
      keys: KEYS,
      userAgent: 'Mozilla/5.0 (Android)',
    }).expect(204);
    await subscribe('operator', {
      endpoint: ENDPOINT,
      keys: { ...KEYS, auth: 'AAAAAAAAAAAAAAAAAAAAAA' },
    }).expect(204);
    expect(rows).toEqual([
      expect.objectContaining({
        endpoint: ENDPOINT,
        user_id: 'operator',
        organization_id: ORG,
        auth: 'AAAAAAAAAAAAAAAAAAAAAA',
        user_agent: null,
        failure_count: 0,
      }),
    ]);
  });

  it('branchIds: the device follows the chosen branches; a repeat replaces the choice, none resets it to all', async () => {
    await subscribe('operator', {
      endpoint: ENDPOINT,
      keys: KEYS,
      branchIds: [BRANCH_A],
    }).expect(204);
    expect(rows[0].branch_ids).toEqual([BRANCH_A]);
    await subscribe('operator', {
      endpoint: ENDPOINT,
      keys: KEYS,
      branchIds: [BRANCH_A, BRANCH_B],
    }).expect(204);
    expect(rows[0].branch_ids).toEqual([BRANCH_A, BRANCH_B]);
    await subscribe('operator', { endpoint: ENDPOINT, keys: KEYS }).expect(204);
    expect(rows[0].branch_ids).toEqual([]);
    await subscribe('operator', {
      endpoint: ENDPOINT,
      keys: KEYS,
      branchIds: [],
    }).expect(204);
    expect(rows[0].branch_ids).toEqual([]);
  });

  it('a branch of another venue: 404 not_found, nothing saved or changed', async () => {
    const res = await subscribe('operator', {
      endpoint: ENDPOINT,
      keys: KEYS,
      branchIds: [BRANCH_A, FOREIGN_BRANCH],
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
    expect(rows).toEqual([]);
    await subscribe('operator', {
      endpoint: ENDPOINT,
      keys: KEYS,
      branchIds: [BRANCH_A],
    }).expect(204);
    await subscribe('operator', {
      endpoint: ENDPOINT,
      keys: KEYS,
      branchIds: [FOREIGN_BRANCH],
    }).expect(404);
    expect(rows[0].branch_ids).toEqual([BRANCH_A]);
  });

  it('branchIds that are not UUIDs, duplicates in bulk or too many: 400', async () => {
    const res = await subscribe('operator', {
      endpoint: ENDPOINT,
      keys: KEYS,
      branchIds: ['not-a-uuid'],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
    await subscribe('operator', {
      endpoint: ENDPOINT,
      keys: KEYS,
      branchIds: [BRANCH_A, BRANCH_A],
    }).expect(400);
    await subscribe('operator', {
      endpoint: ENDPOINT,
      keys: KEYS,
      branchIds: Array.from(
        { length: 51 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      ),
    }).expect(400);
  });

  it('another staff member signing in on the browser takes the endpoint over', async () => {
    await subscribe('operator', { endpoint: ENDPOINT, keys: KEYS }).expect(204);
    await subscribe('owner', { endpoint: ENDPOINT, keys: KEYS }).expect(204);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe('owner');
  });

  it('unsubscribes its own endpoint; another user cannot remove it (same 204)', async () => {
    await subscribe('operator', { endpoint: ENDPOINT, keys: KEYS }).expect(204);
    await unsubscribe('owner', ENDPOINT).expect(204);
    expect(rows).toHaveLength(1);
    await unsubscribe('operator', ENDPOINT).expect(204);
    expect(rows).toEqual([]);
  });

  it.each([
    ['an http endpoint', { endpoint: 'http://push.example/x', keys: KEYS }],
    ['no keys', { endpoint: ENDPOINT }],
    [
      'a key that is not base64url',
      { endpoint: ENDPOINT, keys: { ...KEYS, auth: 'a+b/=' } },
    ],
    ['an unknown field', { endpoint: ENDPOINT, keys: KEYS, extra: 1 }],
  ])('refuses %s: 400', async (_name, body) => {
    const res = await subscribe('operator', body);
    expect(res.status).toBe(400);
    expect(rows).toEqual([]);
  });

  it('without a token: 401', async () => {
    await request(app.getHttpServer())
      .post('/push/subscriptions')
      .send({ endpoint: ENDPOINT, keys: KEYS })
      .expect(401);
  });
});
