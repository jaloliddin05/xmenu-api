import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
} from 'class-validator';

class CustomerPhoneVerifyDto {
  @ApiProperty({
    example: '+998901234567',
  })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({
    example: '123456',
  })
  @IsString()
  @IsNotEmpty()
  code: string;
}

export default CustomerPhoneVerifyDto