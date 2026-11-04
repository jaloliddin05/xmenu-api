import { Logger } from '@nestjs/common';
import { platformDomainFrom } from '../tenant/host';

type Env = Record<string, string | undefined>;

export interface DomainConfig {
  platformDomain: string | null;
  skipVerification: boolean;
}

/**
 * PLATFORM_DOMAIN and DOMAIN_VERIFY_SKIP at startup. Production refuses to start with the skip flag
 * (anyone could claim any host) or without a platform domain (platform subdomains would not resolve);
 * elsewhere both are warnings.
 */
export function assertDomainConfig(
  env: Env = process.env,
  logger: Pick<Logger, 'warn'> = new Logger('TenantDomain'),
): DomainConfig {
  const isProd = env.NODE_ENV === 'production';
  const skipVerification = env.DOMAIN_VERIFY_SKIP === 'true';
  const platformDomain = platformDomainFrom(env);

  if (skipVerification && isProd) {
    throw new Error(
      'DOMAIN_VERIFY_SKIP=true is not allowed when NODE_ENV=production',
    );
  }
  if (!platformDomain) {
    const text =
      'PLATFORM_DOMAIN is not set or not a host name: {slug}.PLATFORM_DOMAIN addresses will not resolve';
    if (isProd) throw new Error(text);
    logger.warn(text);
  }
  if (skipVerification) {
    logger.warn(
      'DOMAIN_VERIFY_SKIP=true: venue domains are verified without a DNS check',
    );
  }
  return { platformDomain, skipVerification };
}
