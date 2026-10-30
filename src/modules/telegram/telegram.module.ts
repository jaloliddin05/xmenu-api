import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramBotProfileService } from './telegram-bot-profile.service';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramClient } from './telegram-client';

@Module({
  imports: [PrismaModule],
  controllers: [TelegramBotController],
  providers: [TelegramClient, TelegramBotService, TelegramBotProfileService],
  exports: [TelegramClient, TelegramBotService, TelegramBotProfileService],
})
export class TelegramModule {}
