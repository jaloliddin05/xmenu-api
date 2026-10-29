import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { requireStaffOrganizationId } from 'src/infra/http/request-helpers';
import { ConnectTelegramBotDto } from './dto/connect-telegram-bot.dto';
import { TelegramBotStatusDto } from './dto/telegram-bot-status.dto';
import { TelegramBotService } from './telegram-bot.service';

type StaffRequest = Parameters<typeof requireStaffOrganizationId>[0];

/** Owner (dashboard): connect the venue's own Telegram bot. */
@ApiTags('Telegram bot')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'No or invalid owner token' })
@ApiForbiddenResponse({ description: 'The user has no organization' })
@Controller('telegram-bot')
export class TelegramBotController {
  constructor(private readonly bots: TelegramBotService) {}

  @Get()
  @ApiOperation({ summary: 'Connection status of the venue bot' })
  @ApiOkResponse({ type: TelegramBotStatusDto })
  status(@Req() req: StaffRequest) {
    return this.bots.status(requireStaffOrganizationId(req));
  }

  @Put()
  @ApiOperation({
    summary:
      'Connect or replace the bot: checks the token with Telegram, registers the webhook, stores the token encrypted',
  })
  @ApiOkResponse({ type: TelegramBotStatusDto })
  @ApiBadRequestResponse({
    description:
      'invalid_bot_token (malformed or rejected by Telegram), webhook_setup_failed, webhook_url_not_https (server PUBLIC_API_URL is not https)',
  })
  @ApiConflictResponse({
    description: 'bot_already_connected: the bot belongs to another venue',
  })
  connect(@Body() dto: ConnectTelegramBotDto, @Req() req: StaffRequest) {
    return this.bots.connect(requireStaffOrganizationId(req), dto.token);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect the bot and remove its webhook' })
  @ApiNoContentResponse()
  async disconnect(@Req() req: StaffRequest) {
    await this.bots.disconnect(requireStaffOrganizationId(req));
  }
}
