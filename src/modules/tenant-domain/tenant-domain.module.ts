import { FactoryProvider, Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { RevalidateModule } from '../revalidate-queue/revalidate.module';
import { TenantModule } from '../tenant/tenant.module';
import { domainConfigFrom } from './domain-config';
import {
  DnsTxtVerifier,
  DOMAIN_VERIFIER,
  SkipDomainVerifier,
} from './domain-verifier';
import { TenantDomainController } from './tenant-domain.controller';
import { TenantDomainService } from './tenant-domain.service';

type Env = Record<string, string | undefined>;

/** DnsTxtVerifier, or SkipDomainVerifier with DOMAIN_VERIFY_SKIP=true outside production. */
export function createDomainVerifier(env: Env = process.env) {
  if (!domainConfigFrom(env).skipVerification) return new DnsTxtVerifier();
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
  imports: [PrismaModule, TenantModule, RevalidateModule],
  controllers: [TenantDomainController],
  providers: [TenantDomainService, domainVerifierProvider],
})
export class TenantDomainModule {}
