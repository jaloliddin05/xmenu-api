import { SkipPublicRateLimit } from 'src/infra/http/public-rate-limit';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { errorMessage } from 'src/infra/helper/error-text';
import { webhookSecretMatches } from 'src/modules/telegram/domain/webhook-secret';
import { TelegramBotService } from 'src/modules/telegram/telegram-bot.service';
import { Public } from '../decorators/public.decorator';
import { TELEGRAM_UPDATE_QUEUE } from '../services/telegram-update.queue';
import type { TelegramUpdateQueue } from '../services/telegram-update.queue';
import { TelegramVerificationService } from '../services/telegram-verification.service';
import type { TelegramUpdate } from '../services/telegram-verification.service';
import { AppException } from 'src/infra/errors/app-exception';

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

/**
 * Webhook of a venue's own bot (registered by PUT /telegram-bot). The URL carries the bot's
 * stable id, never the slug. Telegram's secret_token header is hashed and compared with the stored
 * hash in constant time.
 * Answers 200 as soon as an authentic update is queued (or recognised as a repeat): handling it,
 * including replies through the Bot API, happens in the telegram-update queue, so a slow Telegram
 * never holds the response. Only a failure to queue answers 503, and Telegram delivers it again.
 */
@ApiExcludeController()
@Public()
@SkipPublicRateLimit()
@Controller('telegram/bot')
export class TelegramBotWebhookController {
  private readonly logger = new Logger('TelegramBotWebhook');

  constructor(
    private readonly bots: TelegramBotService,
    private readonly verification: TelegramVerificationService,
    @Inject(TELEGRAM_UPDATE_QUEUE)
    private readonly updates: TelegramUpdateQueue,
  ) {}

  @Post(':botKey/webhook')
  @HttpCode(200)
  async webhook(
    @Param('botKey') botKey: string,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: TelegramUpdate,
  ) {
    if (!UUID_RE.test(botKey)) throw new AppException('not_found');
    const bot = await this.bots.byKey(botKey);
    if (!bot) throw new AppException('not_found');

    if (!webhookSecretMatches(secret, bot.webhookSecretHash)) {
      throw new AppException('unauthorized');
    }

    const updateId = update?.update_id;
    if (!(await this.verification.claimUpdate(bot.botKey, updateId))) {
      return { ok: true }; // a repeat delivery: already queued
    }
    try {
      await this.updates.enqueue({ botKey: bot.botKey, update });
    } catch (e) {
      this.logger.error(
        `enqueue failed for bot ${bot.botKey} update ${String(updateId)}: ${errorMessage(e)}`,
      );
      await this.verification
        .releaseUpdate(bot.botKey, updateId)
        .catch(() => undefined);
      throw new AppException('unavailable');
    }
    return { ok: true };
  }
}
