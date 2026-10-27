import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { OrderCoreModule } from '../order/order-core.module';
import { ClickController } from './controllers/click.controller';
import { PaymeController } from './controllers/payme.controller';
import { PaymentProviderController } from './controllers/payment-provider.controller';
import { PaymentConfigService } from './services/payment-config.service';
import { PaymentLinkService } from './services/payment-link.service';
import { RefundProcessor } from './services/refund.processor';

@Module({
  imports: [PrismaModule, OrderCoreModule],
  controllers: [ClickController, PaymeController, PaymentProviderController],
  providers: [PaymentConfigService, PaymentLinkService, RefundProcessor],
  exports: [PaymentConfigService, PaymentLinkService],
})
export class PaymentModule {}
