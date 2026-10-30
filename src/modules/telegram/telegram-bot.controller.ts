import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { requireStaffOrganizationId } from 'src/infra/http/request-helpers';
import { ConnectTelegramBotDto } from './dto/connect-telegram-bot.dto';
import {
  SaveBotProfileDto,
  TelegramBotFullStatusDto,
} from './dto/telegram-bot-profile.dto';
import { TelegramBotProfileService } from './telegram-bot-profile.service';
import { TelegramBotService } from './telegram-bot.service';

type StaffRequest = Parameters<typeof requireStaffOrganizationId>[0];

/** Owner (dashboard): connect the venue's own Telegram bot. */
@ApiTags('Telegram bot')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'No or invalid owner token' })
@ApiForbiddenResponse({ description: 'The user has no organization' })
@Controller('telegram-bot')
export class TelegramBotController {
  constructor(
    private readonly bots: TelegramBotService,
    private readonly profile: TelegramBotProfileService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Connection status of the venue bot and the profile pushed to it',
  })
  @ApiOkResponse({ type: TelegramBotFullStatusDto })
  status(@Req() req: StaffRequest) {
    return this.profile.fullStatus(requireStaffOrganizationId(req));
  }

  @Put()
  @ApiOperation({
    summary:
      'Connect or replace the bot: checks the token with Telegram, registers the webhook, stores the token encrypted, then pushes the profile (name, descriptions, /start command, menu button). A failed profile push does not fail the connection: see lastSync',
  })
  @ApiOkResponse({ type: TelegramBotFullStatusDto })
  @ApiBadRequestResponse({
    description:
      'invalid_bot_token (malformed or rejected by Telegram), webhook_setup_failed, webhook_url_not_https (server PUBLIC_API_URL is not https)',
  })
  @ApiConflictResponse({
    description: 'bot_already_connected: the bot belongs to another venue',
  })
  async connect(@Body() dto: ConnectTelegramBotDto, @Req() req: StaffRequest) {
    const organizationId = requireStaffOrganizationId(req);
    await this.bots.connect(organizationId, dto.token);
    try {
      await this.profile.apply(organizationId);
    } catch {
      // apply() records per-item failures itself; anything else must not undo the connection
    }
    return this.profile.fullStatus(organizationId);
  }

  @Put('profile')
  @ApiOperation({
    summary: 'Save the bot profile (per language) and push it to Telegram',
  })
  @ApiOkResponse({ type: TelegramBotFullStatusDto })
  @ApiBadRequestResponse({
    description:
      'validation_error with errors[] (ru.name, uz.description, ...): lengths, empty fields, languages not enabled for the venue',
  })
  @ApiNotFoundResponse({ description: 'bot_not_connected' })
  async saveProfile(@Body() dto: SaveBotProfileDto, @Req() req: StaffRequest) {
    const organizationId = requireStaffOrganizationId(req);
    await this.profile.save(organizationId, dto.profile);
    return this.profile.fullStatus(organizationId);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Push the saved profile to Telegram again (e.g. after a failed item)',
  })
  @ApiOkResponse({ type: TelegramBotFullStatusDto })
  @ApiNotFoundResponse({ description: 'bot_not_connected' })
  async sync(@Req() req: StaffRequest) {
    const organizationId = requireStaffOrganizationId(req);
    await this.profile.apply(organizationId);
    return this.profile.fullStatus(organizationId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect the bot and remove its webhook' })
  @ApiNoContentResponse()
  async disconnect(@Req() req: StaffRequest) {
    await this.bots.disconnect(requireStaffOrganizationId(req));
  }
}
