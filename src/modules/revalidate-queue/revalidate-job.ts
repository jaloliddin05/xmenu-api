/** Payload of a revalidation job. `slug` identifies the tenant's menu; organization changes carry the ids. */
export interface RevalidatePayload {
  route?: 'menu' | 'organization';
  slug?: string;
  id?: string;
  newSlug?: string | null;
  oldSlug?: string | null;
}

/**
 * Job id: one pending job per route and tenant. Organization slugs are globally unique, so the slug (menu)
 * or the organization id (organization route) already identifies the tenant. BullMQ custom ids must not
 * contain ':', hence the dash form and URI-encoded parts.
 */
export function buildRevalidateJobId(p: RevalidatePayload): string {
  const route = p.route ?? 'menu';
  const key = route === 'organization' ? p.id : p.slug;
  if (!key) throw new Error(`Revalidation payload without ${route === 'organization' ? 'id' : 'slug'}`);
  return `revalidate-${route}-${encodeURIComponent(key)}`;
}

/** Short, readable description for logs (never an object). */
export function describeRevalidate(p: RevalidatePayload, jobId?: string): string {
  const parts = [`route=${p.route ?? 'menu'}`];
  if (p.slug) parts.push(`slug=${p.slug}`);
  if (p.id) parts.push(`id=${p.id}`);
  if (p.oldSlug || p.newSlug) parts.push(`slug ${p.oldSlug ?? '?'} -> ${p.newSlug ?? '?'}`);
  if (jobId) parts.push(`job=${jobId}`);
  return parts.join(' ');
}

/** Body sent to the QR app's /api/revalidate (format documented in docs/REVALIDATE.md; do not change). */
export function buildRevalidateBody(p: RevalidatePayload, secret: string | undefined) {
  return { route: 'menu', ...p, secret };
}
