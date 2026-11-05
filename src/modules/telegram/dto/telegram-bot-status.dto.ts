import { ApiProperty } from '@nestjs/swagger';

/** GET/PUT /telegram-bot. The token itself is never returned. */
export class TelegramBotStatusDto {
  @ApiProperty({ example: true })
  connected: boolean;

  @ApiProperty({ type: String, nullable: true, example: 'venue_bot' })
  username: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://t.me/venue_bot',
  })
  link: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Registered automatically on connect; shown for diagnostics only',
    example:
      'https://api.example.uz/telegram/bot/0b6a6c3e-7c1f-4b8e-9d4e-3f2a1b0c9d8e/webhook',
  })
  webhookUrl: string | null;

  @ApiProperty({ example: true })
  isEnabled: boolean;
}

/**
 * DELETE /telegram-bot. The bot belongs to the owner: what autoconfiguration set on it (name,
 * descriptions, commands) stays there, only the webhook goes and the menu button returns to default.
 */
export class TelegramBotDisconnectedDto {
  @ApiProperty({ example: false })
  connected: false;

  @ApiProperty({
    enum: ['name', 'description', 'shortDescription', 'commands'],
    isArray: true,
    description:
      'Settings that stay on the bot in Telegram after disconnecting; the owner changes them in @BotFather. Empty when no bot was connected',
    example: ['name', 'description', 'shortDescription', 'commands'],
  })
  leftOnBot: BotSettingLeft[];
}

export type BotSettingLeft =
  | 'name'
  | 'description'
  | 'shortDescription'
  | 'commands';
