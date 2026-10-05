import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

// Format (invalid_phone) servisda tekshiriladi, shunda xato kodi shartnomadagidek chiqadi.
class CustomerOtpRequestDto {
  @ApiProperty({ example: '+998901234567' })
  @IsString()
  phone: string;
}

export default CustomerOtpRequestDto;
