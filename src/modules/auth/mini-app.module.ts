import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { TelegramModule } from '../telegram/telegram.module';
import { INIT_DATA_CONFIG, loadInitDataConfig } from './customer-auth.config';
import { MiniAppAccessService } from './services/mini-app-access.service';
import { TelegramInitDataService } from './services/telegram-init-data.service';

/**
 * The initData check and the delivery-mode rule, without the rest of AuthModule (JWT, queues):
 * POST /orders needs them too.
 */
@Module({
  imports: [PrismaModule, TelegramModule],
  providers: [
    { provide: INIT_DATA_CONFIG, useFactory: loadInitDataConfig },
    TelegramInitDataService,
    MiniAppAccessService,
  ],
  exports: [TelegramInitDataService, MiniAppAccessService],
})
export class MiniAppModule {}
