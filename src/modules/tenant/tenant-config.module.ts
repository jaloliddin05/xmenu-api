import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { GuestLoginModule } from '../guest-login/guest-login.module';
import { OrderCoreModule } from '../order/order-core.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { TenantConfigController } from './tenant-config.controller';
import { TenantConfigService } from './tenant-config.service';
import { TenantModule } from './tenant.module';

/**
 * GET /tenant/config. Kept out of TenantModule, which most modules import, because it also needs
 * the ordering settings from OrderCoreModule and the branch delivery pricing from DeliveryModule.
 */
@Module({
  imports: [
    PrismaModule,
    TenantModule,
    OrderCoreModule,
    GuestLoginModule,
    DeliveryModule,
  ],
  controllers: [TenantConfigController],
  providers: [TenantConfigService],
})
export class TenantConfigModule {}
