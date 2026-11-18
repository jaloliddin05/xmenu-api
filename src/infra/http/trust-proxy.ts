import { isIP } from 'node:net';
import type { Env, EnvIssues } from 'src/config/env/env-issues';

// Address ranges proxy-addr (Express `trust proxy`) knows by name
const NAMED_RANGES: ReadonlySet<string> = new Set([
  'loopback',
  'linklocal',
  'uniquelocal',
]);

const DEFAULT_TRUST: readonly string[] = ['loopback'];

/** `loopback`, an IP address or a CIDR (10.0.0.0/8, fd00::/8). */
function isTrustEntry(entry: string): boolean {
  if (NAMED_RANGES.has(entry)) return true;
  const [ip, bits, ...rest] = entry.split('/');
  const version = isIP(ip);
  if (!version || rest.length) return false;
  if (bits === undefined) return true;
  return /^\d{1,3}$/.test(bits) && Number(bits) <= (version === 4 ? 32 : 128);
}

/**
 * TRUST_PROXY: who may set X-Forwarded-For, comma-separated names (`loopback`, `linklocal`, `uniquelocal`),
 * IP addresses and CIDRs. Unset or blank: `loopback` (a proxy on the same host). Behind Caddy in Docker the
 * proxy is another container: `uniquelocal` or the subnet of the compose network. "Trust everyone" (`true`,
 * a hop count) is not accepted: any client could then pick its own IP for the rate limits.
 * → the value for Express `trust proxy`, or null when an entry is unreadable.
 */
export function parseTrustProxy(raw: string | undefined): string[] | null {
  const entries = (raw ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  if (!entries.length) return [...DEFAULT_TRUST];
  return entries.every(isTrustEntry) ? entries : null;
}

/** Startup check (validateEnv): an unreadable TRUST_PROXY stops the start everywhere. */
export function trustProxyEnvIssues(env: Env = process.env): EnvIssues {
  return parseTrustProxy(env.TRUST_PROXY)
    ? { errors: [], warnings: [] }
    : {
        errors: [
          'TRUST_PROXY must list loopback, linklocal, uniquelocal, IP addresses or CIDRs',
        ],
        warnings: [],
      };
}
