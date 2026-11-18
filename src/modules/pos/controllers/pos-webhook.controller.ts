import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipPublicRateLimit } from 'src/infra/http/public-rate-limit';
import { Public } from 'src/modules/auth/decorators/public.decorator';
import { PosWebhookService } from '../services/pos-webhook.service';

/**
 * iiko webhook (set by POST /integrations/iiko/enable). Answers 200 as soon as the events are
 * queued: iiko blocks webhooks that answer slowly. Contract: docs/API.md, "Интеграция с кассой (iiko)".
 */
@ApiExcludeController()
@Public()
@SkipPublicRateLimit()
@Controller('pos/iiko')
export class PosWebhookController {
  constructor(private readonly webhooks: PosWebhookService) {}

  @Post(':integrationId/webhook')
  @HttpCode(200)
  async webhook(
    @Param('integrationId') integrationId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    await this.webhooks.receive(integrationId, authorization, body);
    return { ok: true };
  }
}
