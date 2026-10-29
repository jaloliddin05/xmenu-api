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
import { OrderCoreModule } from './order-core.module';
import { RevalidateModule } from '../revalidate-queue/revalidate.module';
import { OrderStaffService } from './services/order-staff.service';
import { OrderService } from './services/order.service';

/** Buyurtma API'si: mijoz, restoran paneli, Telegram tugmalari, sozlamalar. Yadro — OrderCoreModule. */
@Module({
  imports: [
    PrismaModule,
    TenantModule,
    BranchModule,
    PaymentModule,
    OrderCoreModule,
    RevalidateModule,
  ],
  controllers: [
    CustomerOrderController,
    StaffOrderController,
    OrderSettingsController,
    CheckoutConfigController,
    TelegramOrdersController,
  ],
  providers: [OrderService, OrderStaffService],
  exports: [OrderService, OrderStaffService],
})
export class OrderModule {}
