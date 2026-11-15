import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { OrderCoreModule } from '../order/order-core.module';
import { RevalidateModule } from '../revalidate-queue/revalidate.module';
import { TenantModule } from '../tenant/tenant.module';
import { BranchDeliveryPricingController } from './controllers/branch-delivery-pricing.controller';
import { DeliveryQuoteController } from './controllers/delivery-quote.controller';
import { DeliveryPricingService } from './services/delivery-pricing.service';
import { DeliveryQuoteService } from './services/delivery-quote.service';

/**
 * Delivery pricing (docs/DELIVERY.md): branch rules for the owner, the delivery branch and price for an
 * address (cart quote and POST /orders). Pure rules: branch/domain/delivery-pricing.ts.
 */
@Module({
  imports: [
    PrismaModule,
    TenantModule,
    BranchModule,
    OrderCoreModule,
    RevalidateModule,
  ],
  controllers: [BranchDeliveryPricingController, DeliveryQuoteController],
  providers: [DeliveryPricingService, DeliveryQuoteService],
  exports: [DeliveryPricingService, DeliveryQuoteService],
})
export class DeliveryModule {}
