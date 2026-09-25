import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
} from 'class-validator';

class CustomerTelegramRegisterDto {
  @ApiProperty({
    description:
      'Telegram WebApp initData',
  })
  @IsString()
  @IsNotEmpty()
  initData: string;

  @ApiProperty({
    example: '+998901234567',
  })
  @IsString()
  @IsNotEmpty()
  phone: string;
}

export default CustomerTelegramRegisterDto