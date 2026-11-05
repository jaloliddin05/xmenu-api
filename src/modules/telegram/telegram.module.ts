import { Module, OnModuleInit } from '@nestjs/common';
import { assertTelegramApiConfig } from 'src/infra/telegram/telegram-api-url';
import { PrismaModule } from '../_prisma/prisma.module';
import { RevalidateModule } from '../revalidate-queue/revalidate.module';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramBotProfileService } from './telegram-bot-profile.service';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramClient } from './telegram-client';

@Module({
  imports: [PrismaModule, RevalidateModule],
  controllers: [TelegramBotController],
  providers: [TelegramClient, TelegramBotService, TelegramBotProfileService],
  exports: [TelegramClient, TelegramBotService, TelegramBotProfileService],
})
export class TelegramModule implements OnModuleInit {
  onModuleInit() {
    // Every Bot API caller (venue bots, order notifications, OTP group) uses this base
    assertTelegramApiConfig();
  }
}
