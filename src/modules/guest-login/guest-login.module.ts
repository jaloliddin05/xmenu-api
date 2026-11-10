import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { OrderCoreModule } from '../order/order-core.module';
import { TelegramModule } from '../telegram/telegram.module';
import { GuestLoginService } from './guest-login.service';

/** Customer sign-in methods of a venue (guest-login.service.ts). */
@Module({
  imports: [PrismaModule, TelegramModule, OrderCoreModule],
  providers: [GuestLoginService],
  exports: [GuestLoginService],
})
export class GuestLoginModule {}
