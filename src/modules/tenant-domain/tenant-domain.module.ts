import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { RevalidateModule } from '../revalidate-queue/revalidate.module';
import { TenantModule } from '../tenant/tenant.module';
import { assertDomainConfig } from './domain-config';
import {
  DnsTxtVerifier,
  DOMAIN_VERIFIER,
  SkipDomainVerifier,
} from './domain-verifier';
import { TenantDomainController } from './tenant-domain.controller';
import { TenantDomainService } from './tenant-domain.service';

@Module({
  imports: [PrismaModule, TenantModule, RevalidateModule],
  controllers: [TenantDomainController],
  providers: [
    TenantDomainService,
    {
      provide: DOMAIN_VERIFIER,
      // Startup check: production refuses DOMAIN_VERIFY_SKIP and a missing PLATFORM_DOMAIN
      useFactory: () =>
        assertDomainConfig().skipVerification
          ? new SkipDomainVerifier()
          : new DnsTxtVerifier(),
    },
  ],
})
export class TenantDomainModule {}
