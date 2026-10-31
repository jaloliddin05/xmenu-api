import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsIn, ValidateNested } from 'class-validator';
import {
  CHECKLIST_IDS,
  CHECKLIST_STATUSES,
  DELIVERY_MODES,
} from '../domain/publication';
import type {
  Channels,
  ChecklistId,
  ChecklistItem,
  ChecklistStatus,
  DeliveryMode,
} from '../domain/publication';

export class DeliveryChannelDto {
  @ApiProperty({
    example: true,
    description:
      'Ordering channel: website and/or Mini App orders (delivery and pickup). false also unpublishes',
  })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    enum: DELIVERY_MODES,
    example: 'site',
    description:
      'site: {slug}.xmenu.uz; miniapp: the Telegram Mini App; both. miniapp and both need a connected bot',
  })
  @IsIn(DELIVERY_MODES)
  mode: DeliveryMode;
}

/** PUT /organization/:id/channels body (the whole document) and the channels part of the answers. */
export class ChannelsDto implements Channels {
  @ApiProperty({
    example: true,
    description:
      'QR menu; the QR front-end reads it from GET /tenant/config (channels.qr)',
  })
  @IsBoolean()
  qr: boolean;

  @ApiProperty({ type: DeliveryChannelDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => DeliveryChannelDto)
  delivery: DeliveryChannelDto;
}

export class ChecklistItemDto implements ChecklistItem {
  @ApiProperty({ enum: CHECKLIST_IDS, example: 'branch' })
  id: ChecklistId;

  @ApiProperty({
    enum: CHECKLIST_STATUSES,
    example: 'todo',
    description:
      'todo blocks publication; not_required: the item does not apply (no delivering branch, website mode)',
  })
  status: ChecklistStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Укажите у филиала часы работы (или «круглосуточно»)',
    description: 'What to fix, in Russian; null unless status is todo',
  })
  hint: string | null;
}

/** Answer of every publication endpoint: state, channels and the checklist. */
export class PublicationViewDto {
  @ApiProperty({
    example: false,
    description: 'Orders are open: published implies delivery.enabled',
  })
  published: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When the current publication started; null when not published or paused',
  })
  publishedAt: string | null;

  @ApiProperty({
    example: false,
    description:
      'No checklist item is todo. A published venue may become not ready (menu, branch or zone edited later): it stays published',
  })
  ready: boolean;

  @ApiProperty({ type: ChannelsDto })
  channels: ChannelsDto;

  @ApiProperty({
    type: ChecklistItemDto,
    isArray: true,
    description: 'Every item, always in the same order',
  })
  checklist: ChecklistItemDto[];
}

export class PublicationMissingDto {
  @ApiProperty({
    type: ChecklistItemDto,
    isArray: true,
    description: 'Items with status todo',
  })
  missing: ChecklistItemDto[];
}

/** 409 publication_incomplete (owner error shape, ErrorFilter). */
export class PublicationIncompleteErrorDto {
  @ApiProperty({ example: 409 })
  status: number;

  @ApiProperty({ format: 'date-time' })
  timestamp: string;

  @ApiProperty({ enum: ['publication_incomplete'] })
  code: string;

  @ApiProperty({ example: 'Publication checklist is not complete' })
  message: string;

  @ApiProperty({ type: PublicationMissingDto })
  details: PublicationMissingDto;
}

/** 422 telegram_bot_required (owner error shape, ErrorFilter). */
export class TelegramBotRequiredErrorDto {
  @ApiProperty({ example: 422 })
  status: number;

  @ApiProperty({ format: 'date-time' })
  timestamp: string;

  @ApiProperty({ enum: ['telegram_bot_required'] })
  code: string;

  @ApiProperty({
    example: 'Connect the venue Telegram bot before choosing the Mini App',
  })
  message: string;
}
