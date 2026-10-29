import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ConnectTelegramBotDto {
  @ApiProperty({
    description: 'Bot token from @BotFather',
    example: '123456789:AA...',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;
}
