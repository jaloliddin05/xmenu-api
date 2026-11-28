import { MiniAppModule } from '../auth/mini-app.module';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { PaymentModule } from '../payment/payment.module';
import { TenantModule } from '../tenant/tenant.module';
import { CheckoutConfigController } from './controllers/checkout-config.controller';
import { CustomerOrderController } from './controllers/customer-order.controller';
import { OrderSettingsController } from './controllers/order-settings.controller';
import { StaffOrderController } from './controllers/staff-order.controller';
import { TelegramOrdersController } from './controllers/telegram-orders.controller';
import { BranchChatController } from './controllers/branch-chat.controller';
import { BranchChatBindingService } from './services/branch-chat-binding.service';
import { RateLimitService } from '../auth/services/rate-limit.service';
import { OrderCoreModule } from './order-core.module';
import { RevalidateModule } from '../revalidate-queue/revalidate.module';
import { OrderStaffService } from './services/order-staff.service';
import { OrderBoardService } from './services/order-board.service';
import { OrderService } from './services/order.service';
import { DeliveryModule } from '../delivery/delivery.module';

/** Buyurtma API'si: mijoz, restoran paneli, Telegram tugmalari, sozlamalar. Yadro — OrderCoreModule. */
@Module({
  imports: [
    PrismaModule,
    TenantModule,
    BranchModule,
    PaymentModule,
    OrderCoreModule,
    RevalidateModule,
    MiniAppModule,
    DeliveryModule,
  ],
  controllers: [
    CustomerOrderController,
    StaffOrderController,
    OrderSettingsController,
    CheckoutConfigController,
    TelegramOrdersController,
    BranchChatController,
  ],
  providers: [
    OrderService,
    OrderStaffService,
    OrderBoardService,
    BranchChatBindingService,
    RateLimitService,
  ],
  exports: [OrderService, OrderStaffService],
})
export class OrderModule {}
