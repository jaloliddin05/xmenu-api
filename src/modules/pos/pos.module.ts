import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { OrderCoreModule } from '../order/order-core.module';
import { RevalidateModule } from '../revalidate-queue/revalidate.module';
import { PosIikoController } from './controllers/pos-iiko.controller';
import { PosOrderController } from './controllers/pos-order.controller';
import { PosWebhookController } from './controllers/pos-webhook.controller';
import { IikoApiClient } from './iiko/iiko-api.client';
import { IikoProvider } from './iiko/iiko.provider';
import { POS_PROVIDER } from './provider/pos-provider';
import { PosImageStore } from './services/pos-image.store';
import { PosIntegrationService } from './services/pos-integration.service';
import { PosKeyring } from './services/pos-keyring';
import { PosMenuImportService } from './services/pos-menu-import.service';
import { PosOrderStatusService } from './services/pos-order-status.service';
import { PosOrderProcessor } from './services/pos-order.processor';
import { PosOrderQueue } from './services/pos-order.queue';
import { PosOrderService } from './services/pos-order.service';
import { PosStopListService } from './services/pos-stop-list.service';
import { PosSyncQueue } from './services/pos-sync.queue';
import { PosWebhookService } from './services/pos-webhook.service';

/**
 * POS integration (iiko, ../docs/IIKO.md): connection, menu import, stop list, webhooks, accepted
 * orders sent to iiko and its statuses.
 */
@Module({
  imports: [PrismaModule, RevalidateModule, OrderCoreModule],
  controllers: [PosIikoController, PosOrderController, PosWebhookController],
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
    PosOrderQueue,
    PosOrderService,
    PosOrderStatusService,
    PosOrderProcessor,
  ],
  exports: [PosOrderService, PosIntegrationService],
})
export class PosModule {}
