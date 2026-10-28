import { RevalidateService } from './revalidate.service';
import { buildRevalidateBody, buildRevalidateJobId, describeRevalidate } from './revalidate-job';

describe('revalidate job ids (P-04)', () => {
  it('never contains an object in the key (the old key was "revalidate-[object Object]" for everyone)', () => {
    const id = buildRevalidateJobId({ slug: 'mant' });
    expect(id).not.toMatch(/object/i);
    expect(id).toBe('revalidate-menu-mant');
  });

  it('differs for different tenants and routes', () => {
    const a = buildRevalidateJobId({ slug: 'mant' });
    const b = buildRevalidateJobId({ slug: 'other' });
    const c = buildRevalidateJobId({ route: 'organization', id: 'org-1', newSlug: 'x', oldSlug: 'mant' });
    const d = buildRevalidateJobId({ route: 'organization', id: 'org-2', newSlug: 'x', oldSlug: 'other' });
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it('is stable for the same tenant and route, so repeated edits still collapse into one job', () => {
    expect(buildRevalidateJobId({ slug: 'mant' })).toBe(buildRevalidateJobId({ slug: 'mant' }));
    expect(buildRevalidateJobId({ route: 'organization', id: 'o', newSlug: 'a' })).toBe(
      buildRevalidateJobId({ route: 'organization', id: 'o', newSlug: 'b' }),
    );
  });

  it('is BullMQ-safe: no ":" even for odd slugs, and odd slugs cannot collide with other routes', () => {
    const id = buildRevalidateJobId({ slug: 'a:b/c d' });
    expect(id).not.toContain(':');
    expect(id).not.toBe(buildRevalidateJobId({ route: 'organization', id: 'a:b/c d' }));
  });

  it('refuses a payload that would produce a shared key', () => {
    expect(() => buildRevalidateJobId({})).toThrow();
    expect(() => buildRevalidateJobId({ route: 'organization', slug: 'mant' })).toThrow();
  });

  it('logs readable text', () => {
    const text = describeRevalidate({ route: 'organization', id: 'o1', oldSlug: 'a', newSlug: 'b' }, 'j1');
    expect(text).toBe('route=organization id=o1 slug a -> b job=j1');
    expect(text).not.toContain('[object Object]');
  });

  it('keeps the request body format for the QR app unchanged', () => {
    expect(buildRevalidateBody({ slug: 'mant' }, 's')).toEqual({ route: 'menu', slug: 'mant', secret: 's' });
    expect(buildRevalidateBody({ id: 'o', newSlug: 'n', oldSlug: 'p', route: 'organization' }, 's')).toEqual({
      route: 'organization', id: 'o', newSlug: 'n', oldSlug: 'p', secret: 's',
    });
  });
});

describe('RevalidateService.addRevalidationJob', () => {
  const make = () => {
    const queue = { remove: jest.fn(async () => 0), add: jest.fn(async () => ({})) };
    const service = Object.create(RevalidateService.prototype) as RevalidateService;
    (service as any).queue = queue;
    return { service, queue };
  };

  it('schedules one job per tenant: two tenants in the same window do not replace each other', async () => {
    const { service, queue } = make();
    await service.addRevalidationJob({ slug: 'mant' });
    await service.addRevalidationJob({ slug: 'other' });
    const ids = queue.add.mock.calls.map((c: any[]) => c[2].jobId);
    expect(ids).toEqual(['revalidate-menu-mant', 'revalidate-menu-other']);
    expect(queue.remove.mock.calls.map((c: any[]) => c[0])).toEqual(ids);
  });

  it('repeated edit of one tenant replaces its pending job', async () => {
    const { service, queue } = make();
    await service.addRevalidationJob({ slug: 'mant' });
    await service.addRevalidationJob({ slug: 'mant' });
    expect(queue.remove).toHaveBeenCalledTimes(2);
    expect(new Set(queue.add.mock.calls.map((c: any[]) => c[2].jobId)).size).toBe(1);
  });
});
