import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { TelegramBotService } from 'src/modules/telegram/telegram-bot.service';
import { Public } from '../decorators/public.decorator';
import { TelegramVerificationService } from '../services/telegram-verification.service';
import type { TelegramUpdate } from '../services/telegram-verification.service';

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

/**
 * Webhook of a venue's own bot (registered by PUT /telegram-bot). The URL carries the bot's
 * stable id, never the slug. Telegram's secret_token header is compared in constant time.
 * Always answers 200 for authentic requests so Telegram does not retry failed handling.
 */
@ApiExcludeController()
@Public()
@Controller('telegram/bot')
export class TelegramBotWebhookController {
  private readonly logger = new Logger('TelegramBotWebhook');

  constructor(
    private readonly bots: TelegramBotService,
    private readonly verification: TelegramVerificationService,
  ) {}

  @Post(':botKey/webhook')
  @HttpCode(200)
  async webhook(
    @Param('botKey') botKey: string,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: TelegramUpdate,
  ) {
    if (!UUID_RE.test(botKey)) throw new NotFoundException();
    const bot = await this.bots.byKey(botKey);
    if (!bot) throw new NotFoundException();

    const given = Buffer.from(secret ?? '');
    const expected = Buffer.from(bot.webhookSecret);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException();
    }

    try {
      await this.verification.handleUpdate(bot, update);
    } catch (e) {
      this.logger.error(
        `update failed: ${e instanceof Error ? e.stack : String(e)}`,
      );
    }
    return { ok: true };
  }
}
