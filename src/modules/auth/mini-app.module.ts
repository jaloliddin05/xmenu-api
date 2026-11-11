import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { TelegramModule } from '../telegram/telegram.module';
import {
  CUSTOMER_AUTH_CONFIG,
  loadCustomerAuthConfig,
} from './customer-auth.config';
import { MiniAppAccessService } from './services/mini-app-access.service';
import { TelegramInitDataService } from './services/telegram-init-data.service';

/**
 * The initData check and the delivery-mode rule, without the rest of AuthModule (JWT, queues):
 * POST /orders needs them too.
 */
@Module({
  imports: [PrismaModule, TelegramModule],
  providers: [
    { provide: CUSTOMER_AUTH_CONFIG, useFactory: loadCustomerAuthConfig },
    TelegramInitDataService,
    MiniAppAccessService,
  ],
  exports: [TelegramInitDataService, MiniAppAccessService],
})
export class MiniAppModule {}
