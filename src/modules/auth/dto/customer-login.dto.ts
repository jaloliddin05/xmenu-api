import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
} from 'class-validator';

class CustomerTelegramDto {
  @ApiProperty({
    description:
      'Telegram WebApp initData',
    example:
      'query_id=AA...&user=%7B...%7D&auth_date=...&hash=...',
  })
  @IsString()
  @IsNotEmpty()
  initData: string;
}

export default CustomerTelegramDto