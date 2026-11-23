import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { OrderCoreModule } from '../order/order-core.module';
import { RevalidateModule } from '../revalidate-queue/revalidate.module';
import { TenantModule } from '../tenant/tenant.module';
import { BranchDeliveryPricingController } from './controllers/branch-delivery-pricing.controller';
import { DeliveryAreaPublicController } from './controllers/delivery-area-public.controller';
import { DeliveryAreaController } from './controllers/delivery-area.controller';
import { DeliveryQuoteController } from './controllers/delivery-quote.controller';
import { DeliveryRegionsController } from './controllers/delivery-regions.controller';
import { RegionCatalog } from './regions/region-catalog';
import { DeliveryAreaService } from './services/delivery-area.service';
import { DeliveryPricingService } from './services/delivery-pricing.service';
import { DeliveryQuoteService } from './services/delivery-quote.service';

/**
 * Delivery pricing (docs/DELIVERY.md): branch rules and the venue delivery area for the owner, the region
 * catalog, the delivery branch and price for an address (cart quote and POST /orders), the area for the guest
 * map. Pure rules: branch/domain/delivery-pricing.ts and delivery/domain.
 */
@Module({
  imports: [
    PrismaModule,
    TenantModule,
    BranchModule,
    OrderCoreModule,
    RevalidateModule,
  ],
  controllers: [
    BranchDeliveryPricingController,
    DeliveryQuoteController,
    DeliveryAreaPublicController,
    DeliveryAreaController,
    DeliveryRegionsController,
  ],
  providers: [
    DeliveryPricingService,
    DeliveryQuoteService,
    DeliveryAreaService,
    RegionCatalog,
  ],
  exports: [DeliveryPricingService, DeliveryQuoteService, DeliveryAreaService],
})
export class DeliveryModule {}
