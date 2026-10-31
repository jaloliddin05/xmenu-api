import { Module } from '@nestjs/common';
import { OrganizationService } from './services/organization.service';
import { OrganizationController } from './organization.controller';
import { PrismaModule } from '../_prisma/prisma.module';
import { RevalidateModule } from '../revalidate-queue/revalidate.module';
import { TenantModule } from '../tenant/tenant.module';
import { TelegramModule } from '../telegram/telegram.module';
import { OrganizationSettingsController } from './organization-settings.controller';
import { OrganizationSettingsService } from './services/organization-settings.service';
import { OrganizationPublicationController } from './organization-publication.controller';
import { PublicationService } from './services/publication.service';

@Module({
  imports: [PrismaModule, RevalidateModule, TenantModule, TelegramModule],
  controllers: [
    OrganizationController,
    OrganizationSettingsController,
    OrganizationPublicationController,
  ],
  providers: [
    OrganizationService,
    OrganizationSettingsService,
    PublicationService,
  ],
  exports: [OrganizationService],
})
export class OrganizationModule {}
