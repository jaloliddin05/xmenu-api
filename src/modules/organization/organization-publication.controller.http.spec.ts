import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp, staffToken } from 'src/infra/testing/http-app.fake';
import { PrismaService } from '../_prisma/prisma.service';
import { FileService } from '../file/file.service';
import { RevalidateService } from '../revalidate-queue/revalidate.service';
import { TelegramBotProfileService } from '../telegram/telegram-bot-profile.service';
import { TenantService } from '../tenant/tenant.service';
import { OrganizationPublicationController } from './organization-publication.controller';
import { OrganizationService } from './services/organization.service';
import { PublicationService } from './services/publication.service';

const ORG_A = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const ORG_B = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';

interface FakeBranch {
  is_active: boolean;
  latitude: number;
  longitude: number;
  accepts_pickup: boolean;
  accepts_delivery: boolean;
  working_hours: { is_closed: boolean }[];
}

interface Venue {
  org: {
    id: string;
    name: string;
    slug: string | null;
    qr_enabled: boolean;
    delivery_enabled: boolean;
    delivery_mode: 'site' | 'miniapp' | 'both';
    published_at: Date | null;
  };
  categories: { id: string; is_active: boolean | null }[];
  products: { category_id: string; is_active: boolean | null }[];
  branches: FakeBranch[];
  zone: number[][] | null;
  bot: { is_enabled: boolean } | null;
}

const ZONE = [
  [41.36, 69.2],
  [41.37, 69.28],
  [41.34, 69.33],
];
const HOURS = Array.from({ length: 7 }, () => ({ is_closed: false }));
const BRANCH: FakeBranch = {
  is_active: true,
  latitude: 41.31,
  longitude: 69.24,
  accepts_pickup: true,
  accepts_delivery: true,
  working_hours: HOURS,
};

/** As registered: platform channels, empty menu, no branches, no zone, no bot. */
const fresh = (id: string): Venue => ({
  org: {
    id,
    name: 'Demo Cafe',
    slug: id === ORG_A ? 'demo-cafe' : 'other-cafe',
    qr_enabled: true,
    delivery_enabled: false,
    delivery_mode: 'site',
    published_at: null,
  },
  categories: [],
  products: [],
  branches: [],
  zone: null,
  bot: null,
});

/** Everything the checklist needs, ordering channel on, not published yet. */
const ready = (id: string): Venue => ({
  ...fresh(id),
  org: { ...fresh(id).org, delivery_enabled: true },
  categories: [{ id: 'c1', is_active: true }],
  products: [{ category_id: 'c1', is_active: true }],
  branches: [{ ...BRANCH }],
  zone: ZONE,
});

const pick = (row: object, select?: Record<string, boolean>) =>
  select
    ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]))
    : { ...row };

/** Lets other requests run between two database calls, like a real connection would. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('Organization channels and publication (owner)', () => {
  let app: INestApplication;
  let venues: Record<string, Venue>;
  /** Writes that changed published_at (to count parallel publishes). */
  let publishWrites: number;
  /** When true, transactions run one at a time (what the row lock does in PostgreSQL). */
  let serialize: boolean;
  let queue: Promise<unknown>;
  const addRevalidationJob = jest.fn();
  const queryRaw = jest.fn();
  const A = `Bearer ${staffToken('owner-a')}`;
  const NO_ORG = `Bearer ${staffToken('no-org')}`;

  const prisma = {
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => {
      if (!serialize) return fn(prisma);
      const run = queue.then(() => fn(prisma));
      queue = run.catch(() => undefined);
      return run;
    }),
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      queryRaw(sql.join('?'), ...values);
      await tick();
      return [];
    },
    organization: {
      findUnique: jest.fn(async ({ where, select }) => {
        await tick();
        const v = venues[where.id];
        return v ? pick(v.org, select) : null;
      }),
      update: jest.fn(async ({ where, data }) => {
        await tick();
        Object.assign(venues[where.id].org, data);
        return { ...venues[where.id].org };
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        await tick();
        const v = venues[where.id];
        const p = where.published_at;
        const match =
          v &&
          (p === undefined ||
            (p === null && v.org.published_at === null) ||
            (p?.not === null && v.org.published_at !== null));
        if (!match) return { count: 0 };
        Object.assign(v.org, data);
        if ('published_at' in data && data.published_at) publishWrites++;
        return { count: 1 };
      }),
    },
    category: {
      count: jest.fn(async ({ where }) => {
        await tick();
        const v = venues[where.organization_id];
        return v.categories.filter((c) => c.is_active !== false).length;
      }),
    },
    product: {
      count: jest.fn(async ({ where }) => {
        await tick();
        const orgId = where.AND[1].category.organization_id;
        const v = venues[orgId];
        const active = new Set(
          v.categories.filter((c) => c.is_active !== false).map((c) => c.id),
        );
        return v.products.filter(
          (p) => p.is_active !== false && active.has(p.category_id),
        ).length;
      }),
    },
    branch: {
      findMany: jest.fn(async ({ where }) => {
        await tick();
        return venues[where.organization_id].branches.filter(
          (b) => b.is_active === where.is_active,
        );
      }),
    },
    organization_order_settings: {
      findUnique: jest.fn(async ({ where }) => {
        await tick();
        return { delivery_zone: venues[where.organization_id].zone };
      }),
    },
    organization_telegram_bot: {
      findUnique: jest.fn(async ({ where }) => {
        await tick();
        return venues[where.organization_id].bot;
      }),
    },
  };

  beforeAll(async () => {
    app = await createHttpApp(
      {
        controllers: [OrganizationPublicationController],
        providers: [
          PublicationService,
          OrganizationService,
          { provide: PrismaService, useValue: prisma },
          { provide: FileService, useValue: {} },
          { provide: TenantService, useValue: { invalidate: jest.fn() } },
          { provide: RevalidateService, useValue: { addRevalidationJob } },
          { provide: TelegramBotProfileService, useValue: {} },
        ],
      },
      [
        { id: 'owner-a', organization: { id: ORG_A } },
        { id: 'no-org', organization: null },
      ],
    );
  });

  afterAll(() => app.close());
  beforeEach(() => {
    venues = { [ORG_A]: fresh(ORG_A), [ORG_B]: ready(ORG_B) };
    publishWrites = 0;
    serialize = false;
    queue = Promise.resolve();
    jest.clearAllMocks();
  });

  const http = () => request(app.getHttpServer());
  const get = (auth = A, id = ORG_A) =>
    http().get(`/organization/${id}/publication`).set('Authorization', auth);
  const putChannels = (body: unknown, auth = A, id = ORG_A) =>
    http()
      .put(`/organization/${id}/channels`)
      .set('Authorization', auth)
      .send(body as object);
  const publish = (auth = A, id = ORG_A) =>
    http().post(`/organization/${id}/publish`).set('Authorization', auth);
  const unpublish = (auth = A, id = ORG_A) =>
    http().post(`/organization/${id}/unpublish`).set('Authorization', auth);

  const CHANNELS = { qr: true, delivery: { enabled: true, mode: 'site' } };
  const status = (body: { checklist: { id: string; status: string }[] }) =>
    Object.fromEntries(body.checklist.map((i) => [i.id, i.status]));

  describe('GET /organization/:id/publication', () => {
    it('a freshly registered venue: QR on, ordering off, what is left to do', async () => {
      const res = await get().expect(200);
      expect(res.body).toMatchObject({
        published: false,
        publishedAt: null,
        ready: false,
        channels: { qr: true, delivery: { enabled: false, mode: 'site' } },
      });
      expect(status(res.body)).toEqual({
        delivery_channel: 'todo',
        venue_name: 'done',
        venue_slug: 'done',
        menu_category: 'todo',
        menu_product: 'todo',
        branch: 'todo',
        delivery_zone: 'not_required',
        telegram_bot: 'not_required',
      });
      for (const item of res.body.checklist) {
        expect(item.hint === null).toBe(item.status !== 'todo');
      }
    });

    it('a venue with everything in place is ready', async () => {
      venues[ORG_A] = ready(ORG_A);
      const res = await get().expect(200);
      expect(res.body.ready).toBe(true);
      expect(res.body.published).toBe(false);
    });

    it('counts an active dish in an active category only, of this venue', async () => {
      venues[ORG_A] = ready(ORG_A);
      await get().expect(200);
      expect(prisma.product.count).toHaveBeenCalledWith({
        where: {
          AND: [
            { OR: [{ is_active: true }, { is_active: null }] },
            {
              category: {
                organization_id: ORG_A,
                OR: [{ is_active: true }, { is_active: null }],
              },
            },
          ],
        },
      });
    });

    it.each<[string, (v: Venue) => void, string]>([
      [
        'inactive category',
        (v) => (v.categories[0].is_active = false),
        'menu_category',
      ],
      [
        'inactive dish',
        (v) => (v.products[0].is_active = false),
        'menu_product',
      ],
      [
        'dish only in an inactive category',
        (v) => {
          v.categories.push({ id: 'c2', is_active: false });
          v.products = [{ category_id: 'c2', is_active: true }];
        },
        'menu_product',
      ],
      [
        'branch without hours',
        (v) => (v.branches[0].working_hours = []),
        'branch',
      ],
      [
        'branch closed every day',
        (v) =>
          (v.branches[0].working_hours = HOURS.map(() => ({
            is_closed: true,
          }))),
        'branch',
      ],
      [
        'branch without a map point (0, 0)',
        (v) => Object.assign(v.branches[0], { latitude: 0, longitude: 0 }),
        'branch',
      ],
      [
        'branch taking no orders',
        (v) =>
          Object.assign(v.branches[0], {
            accepts_pickup: false,
            accepts_delivery: false,
          }),
        'branch',
      ],
      [
        'only an inactive branch',
        (v) => (v.branches[0].is_active = false),
        'branch',
      ],
      [
        'delivering branch without a zone',
        (v) => (v.zone = null),
        'delivery_zone',
      ],
      [
        'Mini App without a bot',
        (v) => (v.org.delivery_mode = 'miniapp'),
        'telegram_bot',
      ],
      [
        'both modes with a disabled bot',
        (v) => {
          v.org.delivery_mode = 'both';
          v.bot = { is_enabled: false };
        },
        'telegram_bot',
      ],
      ['empty name', (v) => (v.org.name = ' '), 'venue_name'],
      ['no slug', (v) => (v.org.slug = null), 'venue_slug'],
    ])('%s: %s is todo', async (_, change, id) => {
      venues[ORG_A] = ready(ORG_A);
      change(venues[ORG_A]);
      const res = await get().expect(200);
      expect(status(res.body)[id]).toBe('todo');
      expect(res.body.ready).toBe(false);
    });

    it('pickup-only branches need no zone', async () => {
      venues[ORG_A] = ready(ORG_A);
      venues[ORG_A].branches[0].accepts_delivery = false;
      venues[ORG_A].zone = null;
      const res = await get().expect(200);
      expect(status(res.body).delivery_zone).toBe('not_required');
      expect(res.body.ready).toBe(true);
    });

    it('a connected bot satisfies the Mini App', async () => {
      venues[ORG_A] = ready(ORG_A);
      venues[ORG_A].org.delivery_mode = 'miniapp';
      venues[ORG_A].bot = { is_enabled: true };
      const res = await get().expect(200);
      expect(status(res.body).telegram_bot).toBe('done');
      expect(res.body.ready).toBe(true);
    });
  });

  describe('PUT /organization/:id/channels', () => {
    it('replaces the channels, answers with the new state and revalidates', async () => {
      const res = await putChannels({
        qr: false,
        delivery: { enabled: true, mode: 'site' },
      }).expect(200);
      expect(res.body.channels).toEqual({
        qr: false,
        delivery: { enabled: true, mode: 'site' },
      });
      expect(status(res.body).delivery_channel).toBe('done');
      expect(venues[ORG_A].org).toMatchObject({
        qr_enabled: false,
        delivery_enabled: true,
        delivery_mode: 'site',
      });
      expect(addRevalidationJob).toHaveBeenCalledTimes(1);
      expect(addRevalidationJob).toHaveBeenCalledWith({
        tenantId: ORG_A,
        route: 'channels',
      });
    });

    it('the same channels again change nothing and revalidate nothing', async () => {
      await putChannels(CHANNELS).expect(200);
      addRevalidationJob.mockClear();
      prisma.organization.update.mockClear();
      await putChannels(CHANNELS).expect(200);
      expect(prisma.organization.update).not.toHaveBeenCalled();
      expect(addRevalidationJob).not.toHaveBeenCalled();
    });

    it.each(['miniapp', 'both'])(
      '%s without a connected bot: 422 telegram_bot_required, nothing stored',
      async (mode) => {
        const res = await putChannels({
          qr: true,
          delivery: { enabled: true, mode },
        }).expect(422);
        expect(res.body.code).toBe('telegram_bot_required');
        expect(venues[ORG_A].org.delivery_mode).toBe('site');
        expect(venues[ORG_A].org.delivery_enabled).toBe(false);
        expect(addRevalidationJob).not.toHaveBeenCalled();
      },
    );

    it('a disabled bot does not count as connected', async () => {
      venues[ORG_A].bot = { is_enabled: false };
      const res = await putChannels({
        qr: true,
        delivery: { enabled: false, mode: 'miniapp' },
      }).expect(422);
      expect(res.body.code).toBe('telegram_bot_required');
    });

    it.each(['miniapp', 'both'])(
      '%s with a connected bot is stored',
      async (mode) => {
        venues[ORG_A].bot = { is_enabled: true };
        const res = await putChannels({
          qr: true,
          delivery: { enabled: true, mode },
        }).expect(200);
        expect(res.body.channels.delivery.mode).toBe(mode);
        expect(venues[ORG_A].org.delivery_mode).toBe(mode);
      },
    );

    it('turning ordering off unpublishes', async () => {
      venues[ORG_A] = ready(ORG_A);
      await publish().expect(200);
      const res = await putChannels({
        qr: true,
        delivery: { enabled: false, mode: 'site' },
      }).expect(200);
      expect(res.body).toMatchObject({ published: false, publishedAt: null });
      expect(venues[ORG_A].org.published_at).toBeNull();
    });

    it('changing only the mode keeps the publication', async () => {
      venues[ORG_A] = ready(ORG_A);
      venues[ORG_A].bot = { is_enabled: true };
      const at = (await publish().expect(200)).body.publishedAt;
      const res = await putChannels({
        qr: true,
        delivery: { enabled: true, mode: 'both' },
      }).expect(200);
      expect(res.body).toMatchObject({ published: true, publishedAt: at });
    });

    it.each([
      ['no delivery', { qr: true }],
      ['no qr', { delivery: { enabled: true, mode: 'site' } }],
      [
        'qr not boolean',
        { qr: 'yes', delivery: { enabled: true, mode: 'site' } },
      ],
      ['unknown mode', { qr: true, delivery: { enabled: true, mode: 'app' } }],
      ['enabled missing', { qr: true, delivery: { mode: 'site' } }],
      ['unknown field', { ...CHANNELS, published: true }],
      [
        'unknown nested field',
        { qr: true, delivery: { enabled: true, mode: 'site', x: 1 } },
      ],
    ])('400 validation_error: %s', async (_, body) => {
      const res = await putChannels(body).expect(400);
      expect(res.body.code).toBe('validation_error');
      expect(res.body.errors.length).toBeGreaterThan(0);
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });
  });

  describe('POST /organization/:id/publish', () => {
    it('409 publication_incomplete with the todo items; nothing written', async () => {
      const res = await publish().expect(409);
      expect(res.body.code).toBe('publication_incomplete');
      expect(res.body.details.missing.map((i) => i.id)).toEqual([
        'delivery_channel',
        'menu_category',
        'menu_product',
        'branch',
      ]);
      for (const item of res.body.details.missing) {
        expect(item).toEqual({
          id: expect.any(String),
          status: 'todo',
          hint: expect.any(String),
        });
      }
      expect(venues[ORG_A].org.published_at).toBeNull();
      expect(addRevalidationJob).not.toHaveBeenCalled();
    });

    it('ordering channel off blocks an otherwise ready venue', async () => {
      venues[ORG_A] = ready(ORG_A);
      venues[ORG_A].org.delivery_enabled = false;
      const res = await publish().expect(409);
      expect(res.body.details.missing.map((i) => i.id)).toEqual([
        'delivery_channel',
      ]);
    });

    it('publishes a ready venue and revalidates', async () => {
      venues[ORG_A] = ready(ORG_A);
      const res = await publish().expect(200);
      expect(res.body.published).toBe(true);
      expect(new Date(res.body.publishedAt).toISOString()).toBe(
        res.body.publishedAt,
      );
      expect(venues[ORG_A].org.published_at).toEqual(
        new Date(res.body.publishedAt),
      );
      expect(addRevalidationJob).toHaveBeenCalledTimes(1);
      expect(addRevalidationJob).toHaveBeenCalledWith({
        tenantId: ORG_A,
        route: 'channels',
      });
    });

    it('publishing again keeps publishedAt and revalidates nothing', async () => {
      venues[ORG_A] = ready(ORG_A);
      const first = await publish().expect(200);
      addRevalidationJob.mockClear();
      const again = await publish().expect(200);
      expect(again.body.publishedAt).toBe(first.body.publishedAt);
      expect(addRevalidationJob).not.toHaveBeenCalled();
    });

    it('a published venue that became incomplete stays published and shows ready: false', async () => {
      venues[ORG_A] = ready(ORG_A);
      await publish().expect(200);
      venues[ORG_A].products = [];
      const res = await get().expect(200);
      expect(res.body).toMatchObject({ published: true, ready: false });
    });

    it('parallel publishes: one write, the same publishedAt for everyone', async () => {
      venues[ORG_A] = ready(ORG_A);
      const answers = await Promise.all(
        Array.from({ length: 10 }, () => publish()),
      );
      expect(answers.map((r) => r.status)).toEqual(Array(10).fill(200));
      const at = new Set(answers.map((r) => r.body.publishedAt));
      expect(at.size).toBe(1);
      expect(publishWrites).toBe(1);
      expect(addRevalidationJob).toHaveBeenCalledTimes(1);
      expect(venues[ORG_A].org.published_at).toEqual(new Date([...at][0]));
    });

    it('every write locks the organization row first', async () => {
      venues[ORG_A] = ready(ORG_A);
      await publish().expect(200);
      await unpublish().expect(200);
      await putChannels(CHANNELS).expect(200);
      expect(queryRaw).toHaveBeenCalledTimes(3);
      for (const [sql, id] of queryRaw.mock.calls) {
        expect(sql).toMatch(
          /SELECT id FROM organization WHERE id = \? FOR UPDATE/,
        );
        expect(id).toBe(ORG_A);
      }
    });

    it('locked publish and unpublish run in the order they came: the last one wins', async () => {
      venues[ORG_A] = ready(ORG_A);
      serialize = true;
      const [p, u] = await Promise.all([publish(), unpublish()]);
      expect(p.body.published).toBe(true);
      expect(u.body.published).toBe(false);
      expect(venues[ORG_A].org.published_at).toBeNull();

      const [u2, p2] = await Promise.all([unpublish(), publish()]);
      expect(u2.body.published).toBe(false);
      expect(p2.body.published).toBe(true);
      expect(venues[ORG_A].org.published_at).not.toBeNull();
    });
  });

  describe('POST /organization/:id/unpublish', () => {
    it('pauses: orders close, channels stay', async () => {
      venues[ORG_A] = ready(ORG_A);
      await publish().expect(200);
      addRevalidationJob.mockClear();
      const res = await unpublish().expect(200);
      expect(res.body).toMatchObject({
        published: false,
        publishedAt: null,
        ready: true,
        channels: { qr: true, delivery: { enabled: true, mode: 'site' } },
      });
      expect(addRevalidationJob).toHaveBeenCalledTimes(1);
    });

    it('unpublishing a venue that is not published is a no-op 200', async () => {
      const res = await unpublish().expect(200);
      expect(res.body.published).toBe(false);
      expect(addRevalidationJob).not.toHaveBeenCalled();
    });
  });

  describe('access', () => {
    const calls: [string, () => request.Test][] = [
      ['GET publication', () => get(A, ORG_B)],
      ['PUT channels', () => putChannels(CHANNELS, A, ORG_B)],
      ['POST publish', () => publish(A, ORG_B)],
      ['POST unpublish', () => unpublish(A, ORG_B)],
    ];

    it.each(calls)(
      '%s of another owner: 404, nothing read or written',
      async (_, call) => {
        venues[ORG_B].org.published_at = new Date('2026-10-01T00:00:00Z');
        const before = JSON.stringify(venues[ORG_B]);
        await call().expect(404);
        expect(JSON.stringify(venues[ORG_B])).toBe(before);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
        expect(addRevalidationJob).not.toHaveBeenCalled();
      },
    );

    it('403 for a user without an organization', async () => {
      await get(NO_ORG).expect(403);
      await putChannels(CHANNELS, NO_ORG).expect(403);
      await publish(NO_ORG).expect(403);
      await unpublish(NO_ORG).expect(403);
    });

    it('401 without a token', async () => {
      await http().get(`/organization/${ORG_A}/publication`).expect(401);
      await http()
        .put(`/organization/${ORG_A}/channels`)
        .send(CHANNELS)
        .expect(401);
      await http().post(`/organization/${ORG_A}/publish`).expect(401);
      await http().post(`/organization/${ORG_A}/unpublish`).expect(401);
    });
  });
});
