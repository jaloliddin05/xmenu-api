/**
 * A tenant is identified by organization.id (UUID). It is assigned once and never changes, unlike
 * the slug, which owners can rename. Slugs are public vanity names (QR menu, delivery site URL):
 * front-ends turn them into the id once via GET /tenant/by-slug/:slug.
 */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normalised tenant id, or null when the key is not an organization id. */
export function parseTenantId(key: string | undefined | null): string | null {
  const k = (key ?? '').trim();
  return UUID_RE.test(k) ? k.toLowerCase() : null;
}
