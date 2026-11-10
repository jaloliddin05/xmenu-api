import { Env, EnvIssues, isProduction } from 'src/config/env/env-issues';
import { isIP } from 'node:net';
import { platformDomainFrom } from '../tenant/host';

export interface DomainConfig {
  platformDomain: string | null;
  skipVerification: boolean;
  /** DNS servers for the TXT check (dns.Resolver.setServers); empty = the system resolvers. */
  dnsServers: string[];
}

const validPort = (port: string) =>
  /^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535;

/** One server as dns.Resolver.setServers takes it: `ip`, `ipv4:port`, `[ipv6]:port`. */
function isDnsServer(entry: string): boolean {
  if (isIP(entry)) return true;
  const v6 = /^\[([^\]]+)\]:(\d+)$/.exec(entry);
  if (v6) return isIP(v6[1]) === 6 && validPort(v6[2]);
  const v4 = /^([^:]+):(\d+)$/.exec(entry);
  return !!v4 && isIP(v4[1]) === 4 && validPort(v4[2]);
}

/**
 * DOMAIN_VERIFY_DNS_SERVERS: comma-separated `ip[:port]` (e.g. `127.0.0.1:5353` for the fake DNS of the
 * e2e stack). [] when unset or blank, null when an entry is not an IP address with an optional port.
 */
export function parseDnsServers(raw: string | undefined): string[] | null {
  const entries = (raw ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  return entries.every(isDnsServer) ? entries : null;
}

export function domainConfigFrom(env: Env = process.env): DomainConfig {
  return {
    platformDomain: platformDomainFrom(env),
    skipVerification: env.DOMAIN_VERIFY_SKIP === 'true',
    dnsServers: parseDnsServers(env.DOMAIN_VERIFY_DNS_SERVERS) ?? [],
  };
}

/**
 * Startup check (validateEnv) of PLATFORM_DOMAIN, DOMAIN_VERIFY_SKIP and DOMAIN_VERIFY_DNS_SERVERS
 * (an unreadable list stops the start everywhere; in production a set list is a warning). Production refuses to start
 * with the skip flag (anyone could claim any host) or without a platform domain (platform subdomains
 * would not resolve); elsewhere both are warnings.
 */
export function domainEnvIssues(env: Env = process.env): EnvIssues {
  const prod = isProduction(env);
  const { platformDomain, skipVerification } = domainConfigFrom(env);
  const issues: EnvIssues = { errors: [], warnings: [] };
  if (skipVerification) {
    if (prod)
      issues.errors.push(
        'DOMAIN_VERIFY_SKIP=true is not allowed when NODE_ENV=production',
      );
    else
      issues.warnings.push(
        'DOMAIN_VERIFY_SKIP=true: venue domains are verified without a DNS check',
      );
  }
  const dnsServers = parseDnsServers(env.DOMAIN_VERIFY_DNS_SERVERS);
  if (dnsServers === null)
    issues.errors.push(
      'DOMAIN_VERIFY_DNS_SERVERS must be a comma-separated list of IP addresses with an optional port (127.0.0.1:5353, [::1]:53)',
    );
  else if (prod && dnsServers.length)
    issues.warnings.push(
      `DOMAIN_VERIFY_DNS_SERVERS: venue domains are checked with ${dnsServers.join(', ')} instead of the system resolvers`,
    );
  if (!platformDomain) {
    const text =
      'PLATFORM_DOMAIN is not set or not a host name: {slug}.PLATFORM_DOMAIN addresses will not resolve';
    (prod ? issues.errors : issues.warnings).push(text);
  }
  return issues;
}
