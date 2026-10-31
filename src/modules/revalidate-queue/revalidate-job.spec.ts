import { RevalidateService } from './revalidate.service';
import { RevalidateProcessor, revalidateRequest } from './revalidate.processor';
import {
  buildClientBody,
  buildQrBody,
  buildRevalidateJobId,
  describeRevalidate,
  queuedJob,
  ResolvedChange,
  targetsFor,
} from './revalidate-job';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const job = (
  target: 'qr' | 'client',
  change: Partial<ResolvedChange> = {},
): { target: 'qr' | 'client'; change: ResolvedChange } => ({
  target,
  change: { tenantId: T1, route: 'menu', slug: 'mant', ...change },
});

describe('revalidate job ids', () => {
  it('is one key per target, route and tenant, never an object and BullMQ-safe', () => {
    const id = buildRevalidateJobId(job('qr'));
    expect(id).toBe(`revalidate-qr-menu-${T1}`);
    expect(id).not.toMatch(/object|:/i);
    const ids = [
      job('qr'),
      job('client'),
      job('qr', { tenantId: T2 }),
      job('qr', { route: 'organization' }),
      job('client', { route: 'settings' }),
    ].map(buildRevalidateJobId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not depend on the slug, so repeated edits of one tenant collapse per route', () => {
    expect(buildRevalidateJobId(job('qr', { slug: 'a' }))).toBe(
      buildRevalidateJobId(job('qr', { slug: 'b' })),
    );
  });

  it('refuses a job without a tenant', () => {
    expect(() => buildRevalidateJobId(job('qr', { tenantId: '' }))).toThrow();
  });

  it('logs readable text', () => {
    const text = describeRevalidate(
      job('client', { route: 'organization', slug: 'b', oldSlug: 'a' }),
      'j1',
    );
    expect(text).toBe(
      `target=client route=organization tenant=${T1} slug a -> b job=j1`,
    );
  });
});

describe('targets', () => {
  it('QR gets every change but branches; the client only when its URL is set', () => {
    expect(targetsFor('menu', false)).toEqual(['qr']);
    expect(targetsFor('settings', true)).toEqual(['qr', 'client']);
    expect(targetsFor('branches', false)).toEqual([]);
    expect(targetsFor('branches', true)).toEqual(['client']);
  });
});

describe('request bodies', () => {
  it('keeps the QR body format: menu by slug, slug change as the organization route', () => {
    expect(buildQrBody(job('qr').change, 's')).toEqual({
      route: 'menu',
      slug: 'mant',
      secret: 's',
    });
    expect(buildQrBody(job('qr', { route: 'settings' }).change, 's')).toEqual({
      route: 'menu',
      slug: 'mant',
      secret: 's',
    });
    expect(
      buildQrBody(
        job('qr', { route: 'organization', slug: 'new', oldSlug: 'old' })
          .change,
        's',
      ),
    ).toEqual({
      route: 'organization',
      id: T1,
      newSlug: 'new',
      oldSlug: 'old',
      secret: 's',
    });
    expect(
      buildQrBody(
        job('qr', { route: 'organization', oldSlug: null }).change,
        's',
      ),
    ).toEqual({
      route: 'menu',
      slug: 'mant',
      secret: 's',
    });
    expect(buildQrBody(job('qr', { slug: null }).change, 's')).toBeNull();
  });

  it('sends the client { secret, tenantId, route, slug, oldSlug }', () => {
    expect(
      buildClientBody(
        job('client', { route: 'organization', slug: 'new', oldSlug: 'old' })
          .change,
        'c',
      ),
    ).toEqual({
      secret: 'c',
      tenantId: T1,
      route: 'organization',
      slug: 'new',
      oldSlug: 'old',
    });
    expect(
      buildClientBody(job('client', { route: 'branches' }).change, 'c'),
    ).toEqual({
      secret: 'c',
      tenantId: T1,
      route: 'branches',
      slug: 'mant',
      oldSlug: null,
    });
  });

  it('routes each target to its own URL and secret', () => {
    const env = {
      NEXT_PUBLIC_URL: 'https://qr.xmenu.uz',
      REVALIDATE_SECRET: 'q',
      CLIENT_REVALIDATE_URL: 'http://127.0.0.1:3002/api/revalidate',
      CLIENT_REVALIDATE_SECRET: 'c',
    };
    expect(revalidateRequest(job('qr'), env)).toEqual({
      url: 'https://qr.xmenu.uz/api/revalidate',
      body: { route: 'menu', slug: 'mant', secret: 'q' },
    });
    expect(revalidateRequest(job('client'), env)?.url).toBe(
      'http://127.0.0.1:3002/api/revalidate',
    );
    expect(revalidateRequest(job('client'), env)?.body).toMatchObject({
      secret: 'c',
      tenantId: T1,
    });
    expect(
      revalidateRequest(job('client'), { ...env, CLIENT_REVALIDATE_URL: '' }),
    ).toBeNull();
  });
});

describe('RevalidateService.addRevalidationJob', () => {
  const saved = process.env.CLIENT_REVALIDATE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.CLIENT_REVALIDATE_URL;
    else process.env.CLIENT_REVALIDATE_URL = saved;
  });

  const make = (slug: string | null = 'mant') => {
    const queue = {
      remove: jest.fn(async () => 0),
      add: jest.fn(async () => ({})),
    };
    const findUnique = jest.fn(async () => ({ slug }));
    const service = Object.create(
      RevalidateService.prototype,
    ) as RevalidateService;
    Object.assign(service, {
      queue,
      prisma: { organization: { findUnique } },
      logger: { log: jest.fn() },
    });
    return { service, queue, findUnique };
  };

  it('schedules one job per tenant: two tenants in the same window do not replace each other', async () => {
    delete process.env.CLIENT_REVALIDATE_URL;
    const { service, queue } = make();
    await service.addRevalidationJob({
      tenantId: T1,
      route: 'menu',
      slug: 'mant',
    });
    await service.addRevalidationJob({
      tenantId: T2,
      route: 'menu',
      slug: 'other',
    });
    const ids = queue.add.mock.calls.map((c: any[]) => c[2].jobId);
    expect(ids).toEqual([
      `revalidate-qr-menu-${T1}`,
      `revalidate-qr-menu-${T2}`,
    ]);
    expect(queue.remove.mock.calls.map((c: any[]) => c[0])).toEqual(ids);
  });

  it('adds the client job when CLIENT_REVALIDATE_URL is set; the queue holds no slug', async () => {
    process.env.CLIENT_REVALIDATE_URL = 'http://127.0.0.1:3002/api/revalidate';
    const { service, queue, findUnique } = make('mant');
    await service.addRevalidationJob({
      tenantId: T1,
      route: 'settings',
      slug: 'queued-time-slug',
    });
    expect(findUnique).not.toHaveBeenCalled();
    expect(queue.add.mock.calls.map((c: any[]) => c[1])).toEqual([
      { target: 'qr', change: { tenantId: T1, route: 'settings' } },
      { target: 'client', change: { tenantId: T1, route: 'settings' } },
    ]);
  });

  it('keeps oldSlug in the queued job: it is the fact of the rename, not state', () => {
    expect(
      queuedJob('qr', {
        tenantId: T1,
        route: 'organization',
        slug: 'b',
        oldSlug: 'a',
      }),
    ).toEqual({
      target: 'qr',
      change: { tenantId: T1, route: 'organization', oldSlug: 'a' },
    });
    expect(
      queuedJob('qr', { tenantId: T1, route: 'menu', oldSlug: null }).change,
    ).toEqual({
      tenantId: T1,
      route: 'menu',
    });
  });

  it('repeated edit of one tenant replaces its pending job', async () => {
    delete process.env.CLIENT_REVALIDATE_URL;
    const { service, queue } = make();
    await service.addRevalidationJob({
      tenantId: T1,
      route: 'menu',
      slug: 'mant',
    });
    await service.addRevalidationJob({
      tenantId: T1,
      route: 'menu',
      slug: 'mant',
    });
    expect(queue.remove).toHaveBeenCalledTimes(2);
    expect(
      new Set(queue.add.mock.calls.map((c: any[]) => c[2].jobId)).size,
    ).toBe(1);
  });
});

describe('RevalidateProcessor.requestFor', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.NEXT_PUBLIC_URL = 'https://qr.xmenu.uz';
    process.env.REVALIDATE_SECRET = 'q';
    process.env.CLIENT_REVALIDATE_URL = 'http://127.0.0.1:3002/api/revalidate';
    process.env.CLIENT_REVALIDATE_SECRET = 'c';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  const make = (rows: Record<string, { slug: string | null }>) => {
    const processor = Object.create(
      RevalidateProcessor.prototype,
    ) as RevalidateProcessor;
    Object.assign(processor, {
      prisma: {
        organization: {
          findUnique: jest.fn(async ({ where }: any) => rows[where.id] ?? null),
        },
      },
    });
    return processor;
  };

  it('uses the slug at execution time: a rename between queuing and running', async () => {
    const rows = { [T1]: { slug: 'old-name' } };
    const processor = make(rows);
    const queued = queuedJob('qr', {
      tenantId: T1,
      route: 'menu',
      slug: 'old-name',
    });
    rows[T1].slug = 'new-name'; // renamed while the job waited or was retried
    expect((await processor.requestFor(queued))?.body).toEqual({
      route: 'menu',
      slug: 'new-name',
      secret: 'q',
    });
    expect(
      (
        await processor.requestFor(
          queuedJob('client', { tenantId: T1, route: 'branches' }),
        )
      )?.body,
    ).toMatchObject({ tenantId: T1, slug: 'new-name' });
  });

  it('sends the slug change with the current slug as newSlug', async () => {
    const processor = make({ [T1]: { slug: 'b' } });
    const queued = queuedJob('qr', {
      tenantId: T1,
      route: 'organization',
      oldSlug: 'a',
    });
    expect((await processor.requestFor(queued))?.body).toEqual({
      route: 'organization',
      id: T1,
      newSlug: 'b',
      oldSlug: 'a',
      secret: 'q',
    });
  });

  it('skips a tenant that is gone, a tenant without a slug (QR) and a job without a tenant', async () => {
    const processor = make({ [T2]: { slug: null } });
    expect(
      await processor.requestFor(
        queuedJob('qr', { tenantId: T1, route: 'menu' }),
      ),
    ).toBeNull();
    expect(
      await processor.requestFor(
        queuedJob('qr', { tenantId: T2, route: 'menu' }),
      ),
    ).toBeNull();
    expect(await processor.requestFor(undefined)).toBeNull();
    expect(await processor.requestFor({ target: 'qr' } as any)).toBeNull();
  });

  it('still reads jobs queued by the previous format (slug inside)', async () => {
    const processor = make({ [T1]: { slug: 'fresh' } });
    const legacy = {
      target: 'qr',
      change: { tenantId: T1, route: 'menu', slug: 'stale' },
    } as any;
    expect((await processor.requestFor(legacy))?.body).toMatchObject({
      slug: 'fresh',
    });
  });
});
