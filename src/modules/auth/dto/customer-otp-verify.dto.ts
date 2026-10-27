import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

class CustomerOtpVerifyDto {
  @ApiProperty({ example: '+998901234567' })
  @IsString()
  phone: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  code: string;

  @ApiPropertyOptional({ description: 'Telegram WebApp initData — mavjud mijozga Telegram ulash uchun' })
  @IsOptional()
  @IsString()
  initData?: string;
}

export default CustomerOtpVerifyDto;
