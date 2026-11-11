import { FactoryProvider, Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { RevalidateModule } from '../revalidate-queue/revalidate.module';
import { TenantModule } from '../tenant/tenant.module';
import { TelegramModule } from '../telegram/telegram.module';
import { domainConfigFrom } from './domain-config';
import {
  DnsTxtVerifier,
  DOMAIN_VERIFIER,
  SkipDomainVerifier,
  txtResolver,
} from './domain-verifier';
import { TenantDomainController } from './tenant-domain.controller';
import { TenantDomainService } from './tenant-domain.service';

type Env = Record<string, string | undefined>;

/**
 * DnsTxtVerifier (with DOMAIN_VERIFY_DNS_SERVERS when set), or SkipDomainVerifier with
 * DOMAIN_VERIFY_SKIP=true outside production.
 */
export function createDomainVerifier(env: Env = process.env) {
  const config = domainConfigFrom(env);
  if (!config.skipVerification)
    return new DnsTxtVerifier(txtResolver(config.dnsServers));
  // validateEnv already refuses this at startup; the factory never trusts the flag in production
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'DOMAIN_VERIFY_SKIP=true is not allowed when NODE_ENV=production',
    );
  }
  return new SkipDomainVerifier();
}

export const domainVerifierProvider: FactoryProvider = {
  provide: DOMAIN_VERIFIER,
  useFactory: () => createDomainVerifier(),
};

@Module({
  imports: [PrismaModule, TenantModule, RevalidateModule, TelegramModule],
  controllers: [TenantDomainController],
  providers: [TenantDomainService, domainVerifierProvider],
})
export class TenantDomainModule {}
