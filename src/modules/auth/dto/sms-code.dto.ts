import { IsNotEmpty, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class SmsCodeDto {
  @ApiProperty({
    description: `code`,
    example: 12345,
  })
  @IsNotEmpty()
  @IsNumber()
  code: number;
}

export default SmsCodeDto;
