import { ApiProperty } from '@nestjs/swagger';

/** GET/PUT /telegram-bot. Neither the token nor the webhook address (internal bot key) is returned. */
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
