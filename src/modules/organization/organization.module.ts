import { Module } from '@nestjs/common';
import { OrganizationService } from './services/organization.service';
import { OrganizationController } from './organization.controller';
import { PrismaModule } from '../_prisma/prisma.module';
import { RevalidateModule } from '../revalidate-queue/revalidate.module';
import { TenantModule } from '../tenant/tenant.module';
import { OrganizationSettingsController } from './organization-settings.controller';
import { OrganizationSettingsService } from './services/organization-settings.service';

@Module({
  imports:[PrismaModule,RevalidateModule,TenantModule],
  controllers: [OrganizationController, OrganizationSettingsController],
  providers: [OrganizationService, OrganizationSettingsService],
  exports:[OrganizationService]
})
export class OrganizationModule {}
