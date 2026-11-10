import { ErrorResponse } from 'src/infra/errors/error-response.dto';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsIn, ValidateNested } from 'class-validator';
import {
  CHECKLIST_IDS,
  CHECKLIST_STATUSES,
  DELIVERY_MODES,
  PUBLICATION_WARNING_IDS,
} from '../domain/publication';
import type {
  Channels,
  ChecklistId,
  ChecklistItem,
  ChecklistStatus,
  DeliveryMode,
  PublicationWarning,
  PublicationWarningId,
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

export class PublicationWarningDto implements PublicationWarning {
  @ApiProperty({
    enum: PUBLICATION_WARNING_IDS,
    example: 'guest_login_telegram_only',
    description:
      'guest_login_telegram_only: platform SMS is not available, customers sign in through the venue bot only (not raised in the miniapp mode). guest_login_unavailable: neither SMS nor the venue bot works, customers cannot sign in; the platform side is the likely cause',
  })
  id: PublicationWarningId;

  @ApiProperty({
    example:
      'Вход по SMS сейчас недоступен на платформе: гости смогут войти только через Telegram-бота заведения',
    description: 'What it means for the owner, in Russian',
  })
  hint: string;
}

/** Answer of every publication endpoint: state, channels, the checklist and the warnings. */
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

  @ApiProperty({
    type: PublicationWarningDto,
    isArray: true,
    description:
      'Problems that never block publication (POST /publish passes with them). Empty while the ordering channel is off',
  })
  warnings: PublicationWarningDto[];
}

export class PublicationMissingDto {
  @ApiProperty({
    type: ChecklistItemDto,
    isArray: true,
    description: 'Items with status todo',
  })
  missing: ChecklistItemDto[];
}

/** 409 publication_incomplete (the common error shape, ErrorResponse). */
export class PublicationIncompleteErrorDto extends ErrorResponse {
  @ApiProperty({ enum: ['publication_incomplete'] })
  declare code: string;

  @ApiProperty({ type: PublicationMissingDto })
  declare details: PublicationMissingDto;
}

/** 422 telegram_bot_required (the common error shape, ErrorResponse). */
export class TelegramBotRequiredErrorDto extends ErrorResponse {
  @ApiProperty({ enum: ['telegram_bot_required'] })
  declare code: string;
}
