import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { RevalidateModule } from '../revalidate-queue/revalidate.module';
import { PosIikoController } from './controllers/pos-iiko.controller';
import { PosWebhookController } from './controllers/pos-webhook.controller';
import { IikoApiClient } from './iiko/iiko-api.client';
import { IikoProvider } from './iiko/iiko.provider';
import { POS_PROVIDER } from './provider/pos-provider';
import { PosImageStore } from './services/pos-image.store';
import { PosIntegrationService } from './services/pos-integration.service';
import { PosKeyring } from './services/pos-keyring';
import { PosMenuImportService } from './services/pos-menu-import.service';
import { PosStopListService } from './services/pos-stop-list.service';
import { PosSyncQueue } from './services/pos-sync.queue';
import { PosWebhookService } from './services/pos-webhook.service';

/** POS integration (iiko, ../docs/IIKO.md): connection, menu import, stop list, webhooks. */
@Module({
  imports: [PrismaModule, RevalidateModule],
  controllers: [PosIikoController, PosWebhookController],
  providers: [
    IikoApiClient,
    IikoProvider,
    { provide: POS_PROVIDER, useExisting: IikoProvider },
    PosKeyring,
    PosImageStore,
    PosMenuImportService,
    PosStopListService,
    PosSyncQueue,
    PosIntegrationService,
    PosWebhookService,
  ],
})
export class PosModule {}
