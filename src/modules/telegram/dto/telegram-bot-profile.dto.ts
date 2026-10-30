import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';
import { TelegramBotStatusDto } from './telegram-bot-status.dto';

export class BotProfileFieldsDto {
  @ApiProperty({ example: 'Mant', description: 'Bot name, 1-64 characters' })
  name: string;

  @ApiProperty({
    example: 'Menu and food ordering from Mant.',
    description: 'Long description, up to 512 characters (may be empty)',
  })
  description: string;

  @ApiProperty({
    example: 'Menu and food ordering',
    description: 'Short description, 1-120 characters',
  })
  shortDescription: string;

  @ApiProperty({
    example: 'Menu',
    description:
      'Text of the menu button that opens the Mini App, 1-32 characters',
  })
  menuButtonText: string;
}

export class SyncItemDto {
  @ApiProperty({ enum: ['ok', 'failed', 'skipped_no_url'] })
  status: 'ok' | 'failed' | 'skipped_no_url';

  @ApiProperty({
    required: false,
    description: 'Error text from Telegram when status is failed',
  })
  reason?: string;
}

export class SyncResultDto {
  @ApiProperty({ type: SyncItemDto }) name: SyncItemDto;
  @ApiProperty({ type: SyncItemDto }) description: SyncItemDto;
  @ApiProperty({ type: SyncItemDto }) shortDescription: SyncItemDto;
  @ApiProperty({ type: SyncItemDto }) commands: SyncItemDto;
  @ApiProperty({ type: SyncItemDto }) menuButton: SyncItemDto;
}

export class LastSyncDto {
  @ApiProperty({ type: String, format: 'date-time' })
  syncedAt: string;

  @ApiProperty({ type: SyncResultDto })
  result: SyncResultDto;
}

/** GET/PUT /telegram-bot and the profile endpoints: status plus the profile pushed to the bot. */
export class TelegramBotFullStatusDto extends TelegramBotStatusDto {
  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: { $ref: '#/components/schemas/BotProfileFieldsDto' },
    description:
      'Per venue language (ru, uz, en): saved values over the defaults built from the venue data. null while no bot is connected',
  })
  profile: Record<string, BotProfileFieldsDto> | null;

  @ApiProperty({ description: 'false once the owner saved the profile' })
  isDefault: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://cafe-example.xmenu.uz',
    description:
      'Address the menu button opens (DELIVERY_URL_TEMPLATE); null: the button is not set',
  })
  deliveryUrl: string | null;

  @ApiProperty({ type: LastSyncDto, nullable: true })
  lastSync: LastSyncDto | null;
}

export class SaveBotProfileDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/BotProfileFieldsDto' },
    description:
      'Fields per language; only languages enabled in the venue settings. Languages left out keep their values',
  })
  @IsObject()
  profile: Record<string, unknown>;
}
