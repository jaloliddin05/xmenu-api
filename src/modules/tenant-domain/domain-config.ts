import { Env, EnvIssues, isProduction } from 'src/config/env/env-issues';
import { platformDomainFrom } from '../tenant/host';

export interface DomainConfig {
  platformDomain: string | null;
  skipVerification: boolean;
}

export function domainConfigFrom(env: Env = process.env): DomainConfig {
  return {
    platformDomain: platformDomainFrom(env),
    skipVerification: env.DOMAIN_VERIFY_SKIP === 'true',
  };
}

/**
 * Startup check (validateEnv) of PLATFORM_DOMAIN and DOMAIN_VERIFY_SKIP. Production refuses to start
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
  if (!platformDomain) {
    const text =
      'PLATFORM_DOMAIN is not set or not a host name: {slug}.PLATFORM_DOMAIN addresses will not resolve';
    (prod ? issues.errors : issues.warnings).push(text);
  }
  return issues;
}
