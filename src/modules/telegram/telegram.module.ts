import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramClient } from './telegram-client';

@Module({
  imports: [PrismaModule],
  controllers: [TelegramBotController],
  providers: [TelegramClient, TelegramBotService],
  exports: [TelegramClient, TelegramBotService],
})
export class TelegramModule {}
