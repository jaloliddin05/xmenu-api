/**
 * What changed for a tenant. One change becomes one job per front-end (target):
 *  - qr: the QR menu (`NEXT_PUBLIC_URL`, `REVALIDATE_SECRET`), body format fixed by xmenu-qr;
 *  - client: the delivery site (`CLIENT_REVALIDATE_URL`, `CLIENT_REVALIDATE_SECRET`), skipped when the URL is empty.
 * Format: docs/REVALIDATE.md.
 */
export type RevalidateRoute =
  | 'menu'
  | 'organization'
  | 'settings'
  | 'branches'
  /** Channel flags or publication (QR flag for the QR menu, ordering state for the delivery site). */
  | 'channels';
export type RevalidateTarget = 'qr' | 'client';

export interface TenantChange {
  tenantId: string;
  route: RevalidateRoute;
  /**
   * Callers may pass the slug they know, but it is not queued: the processor reads the current slug
   * by tenantId when the job runs, so a rename between queuing and running cannot send a stale one.
   */
  slug?: string | null;
  /** Previous slug, only when the slug changed. */
  oldSlug?: string | null;
}

export interface RevalidateJob {
  target: RevalidateTarget;
  /** As queued: tenantId, route and oldSlug. `slug` is filled in by the processor (resolveJobSlug). */
  change: TenantChange;
}

/** The job as it goes to the front-end: the slug is the tenant's current one (null: no slug). */
export type ResolvedChange = TenantChange & { slug: string | null };

/** What the queue stores: no slug, it is read at execution time. */
export function queuedJob(
  target: RevalidateTarget,
  change: TenantChange,
): RevalidateJob {
  const { tenantId, route, oldSlug } = change;
  return {
    target,
    change: oldSlug ? { tenantId, route, oldSlug } : { tenantId, route },
  };
}

/** Targets that care about a change: the QR menu shows no branches. */
export function targetsFor(
  route: RevalidateRoute,
  clientEnabled: boolean,
): RevalidateTarget[] {
  const targets: RevalidateTarget[] = route === 'branches' ? [] : ['qr'];
  if (clientEnabled) targets.push('client');
  return targets;
}

/**
 * Job id: one pending job per target, route and tenant, so repeated edits within the delay collapse and
 * different tenants never replace each other. BullMQ custom ids must not contain ':'.
 */
export function buildRevalidateJobId(job: RevalidateJob): string {
  const { tenantId, route } = job.change;
  if (!tenantId) throw new Error('Revalidation job without tenantId');
  return `revalidate-${job.target}-${route}-${encodeURIComponent(tenantId)}`;
}

/** Short, readable description for logs (never an object). */
export function describeRevalidate(
  job: Partial<RevalidateJob>,
  jobId?: string,
): string {
  const c: Partial<TenantChange> = job.change ?? {};
  const parts = [
    `target=${job.target ?? '?'}`,
    `route=${c.route ?? '?'}`,
    `tenant=${c.tenantId ?? '?'}`,
  ];
  if (c.oldSlug) parts.push(`slug ${c.oldSlug} -> ${c.slug ?? '?'}`);
  else if (c.slug) parts.push(`slug=${c.slug}`);
  if (jobId) parts.push(`job=${jobId}`);
  return parts.join(' ');
}

/**
 * Body for the QR app's /api/revalidate. Its format is fixed (xmenu-qr reads it): a slug change is the
 * `organization` route with id, newSlug and oldSlug; anything else re-renders the menu by slug.
 * Returns null when there is nothing the QR app can revalidate (no slug).
 */
export function buildQrBody(c: ResolvedChange, secret: string | undefined) {
  if (c.route === 'organization' && c.oldSlug && c.oldSlug !== c.slug) {
    return {
      route: 'organization',
      id: c.tenantId,
      newSlug: c.slug,
      oldSlug: c.oldSlug,
      secret,
    };
  }
  if (!c.slug) return null;
  return { route: 'menu', slug: c.slug, secret };
}

/** Body for the delivery site's /api/revalidate (receiver: xmenu-client). */
export function buildClientBody(c: ResolvedChange, secret: string | undefined) {
  return {
    secret,
    tenantId: c.tenantId,
    route: c.route,
    slug: c.slug,
    oldSlug: c.oldSlug ?? null,
  };
}
