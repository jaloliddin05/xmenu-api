import { domainToASCII, domainToUnicode } from 'node:url';

/**
 * Hosts that name a venue's delivery site. Two kinds, and nothing else is a tenant:
 *  - the platform subdomain {slug}.{PLATFORM_DOMAIN}: resolved by slug, no table row needed;
 *  - any other host (restaurant.uz, order.restaurant.uz, a dev tunnel): only through a verified
 *    tenant_domain row (modules/tenant-domain).
 * Hosts are kept in one canonical form: ASCII (IDN as punycode), lower case, no port, no trailing dot.
 */
export const HOST_MAX = 253;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
// Special-use names (RFC 6761 and friends) that can never be a public venue address
const RESERVED_TLDS: ReadonlySet<string> = new Set([
  'localhost',
  'local',
  'internal',
  'invalid',
  'onion',
  'arpa',
]);

export type HostProblem = 'invalid_host' | 'platform_host' | 'reserved_host';

/** A bare DNS name → canonical ASCII form, or null (IP literal, bad characters, empty or long labels). */
function dnsName(name: string): string | null {
  if (!name || /[\s/\\?#@:[\]]/.test(name)) return null;
  const ascii = domainToASCII(name);
  if (!ascii || ascii.length > HOST_MAX || IPV4_RE.test(ascii)) return null;
  return ascii.split('.').every((l) => LABEL_RE.test(l)) ? ascii : null;
}

/**
 * Host as a front-end sends it (from its Host header, possibly with a port) → canonical host, or null
 * when it is not a DNS name (IP literals included).
 */
export function normalizeHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let host = raw.trim().toLowerCase();
  const colon = host.lastIndexOf(':');
  if (colon !== -1) {
    if (!/^\d{1,5}$/.test(host.slice(colon + 1))) return null;
    host = host.slice(0, colon);
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  return dnsName(host);
}

/** PLATFORM_DOMAIN (xmenu.uz; localhost in development) in canonical form, null when unset or invalid. */
export function platformDomainFrom(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return normalizeHost(env.PLATFORM_DOMAIN ?? '');
}

/** The platform domain itself or any host under it (api.xmenu.uz, a.b.xmenu.uz). */
export function isPlatformHost(
  host: string,
  platformDomain: string | null,
): boolean {
  return (
    !!platformDomain &&
    (host === platformDomain || host.endsWith(`.${platformDomain}`))
  );
}

/**
 * {slug}.{PLATFORM_DOMAIN} with exactly one label → the slug candidate (still to be checked with
 * isValidSlug, which refuses reserved names such as api). Anything else → null.
 */
export function platformSlug(
  host: string,
  platformDomain: string | null,
): string | null {
  if (!platformDomain) return null;
  const suffix = `.${platformDomain}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  return label && !label.includes('.') ? label : null;
}

/**
 * A host an owner wants to add as the venue's own domain. Only a bare host name is taken (no scheme,
 * path or port: those are not part of a domain); case, a trailing dot and IDN are normalised. The
 * platform domain and everything under it is the platform's; special-use names are refused.
 */
export function parseCustomHost(
  raw: unknown,
  platformDomain: string | null,
): { host: string } | { problem: HostProblem } {
  if (typeof raw !== 'string') return { problem: 'invalid_host' };
  let name = raw.trim().toLowerCase();
  if (name.endsWith('.')) name = name.slice(0, -1);
  const host = dnsName(name);
  if (!host) {
    return { problem: IPV4_RE.test(name) ? 'reserved_host' : 'invalid_host' };
  }
  if (isPlatformHost(host, platformDomain)) return { problem: 'platform_host' };
  // The last label; a single-label name is its own "TLD" (localhost)
  const tld = host.slice(host.lastIndexOf('.') + 1);
  if (RESERVED_TLDS.has(tld)) return { problem: 'reserved_host' };
  if (!host.includes('.')) return { problem: 'invalid_host' };
  return { host };
}

/** Readable form of a canonical host (punycode → Unicode) for the dashboard. */
export function hostToUnicode(host: string): string {
  return domainToUnicode(host) || host;
}
