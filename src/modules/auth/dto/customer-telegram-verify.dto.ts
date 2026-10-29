import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

/** POST /auth/customer/telegram/start */
export class CustomerTelegramStartDto {
  @ApiPropertyOptional({
    example: '+998901234567',
    description:
      'Required without initData (website): the code is sent only to the Telegram account whose contact matches this phone. ' +
      'With initData (Mini App) it is optional; if given, the shared contact must match it.',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description:
      'Telegram WebApp initData of the venue bot. Present = Mini App mode: the session is bound to this Telegram user ' +
      'and the contact share confirms the phone directly, no code to type.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  initData?: string;
}

/** POST /auth/customer/telegram/status */
export class CustomerTelegramStatusDto {
  @ApiProperty({ description: 'sessionId from telegram/start' })
  @IsString()
  @Length(20, 64)
  sessionId: string;
}

export class CustomerTelegramStartResponseDto {
  @ApiProperty({
    description: 'Pass to telegram/status; also the deep-link payload',
  })
  sessionId: string;

  @ApiProperty({
    enum: ['instant', 'code'],
    description:
      'instant: Mini App, the contact share signs in; code: website, the bot sends a code to type into otp/verify',
  })
  mode: 'instant' | 'code';

  @ApiProperty({ example: 'venue_bot' })
  botUsername: string;

  @ApiProperty({ example: 'https://t.me/venue_bot?start=SESSION_ID' })
  deepLink: string;

  @ApiProperty({ example: 300, description: 'Session lifetime in seconds' })
  expiresIn: number;
}

export class CustomerTelegramStatusResponseDto {
  @ApiProperty({
    enum: ['pending', 'code_sent', 'verified', 'expired'],
    description:
      'pending: keep polling. code_sent: show the code field, finish with otp/verify. ' +
      'verified: same fields as the otp/verify response (isNewUser, tokens and user, or registrationToken), returned once. ' +
      'expired: start again',
  })
  status: 'pending' | 'code_sent' | 'verified' | 'expired';

  @ApiPropertyOptional({
    example: '+998901234567',
    description: 'code_sent: the phone the code was issued for',
  })
  phone?: string;

  @ApiPropertyOptional({ description: 'verified only' })
  isNewUser?: boolean;
}
