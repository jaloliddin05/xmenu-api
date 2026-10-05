import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

class CustomerRegisterDto {
  @ApiProperty()
  @IsString()
  registrationToken: string;

  @ApiProperty({ example: 'Ali' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Telegram WebApp initData — yangi mijozga Telegram ulash uchun' })
  @IsOptional()
  @IsString()
  initData?: string;
}

export default CustomerRegisterDto;
