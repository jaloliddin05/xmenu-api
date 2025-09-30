import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import formatPhoneNumber from 'src/infra/helper/auth/format-phone';

class PhoneDto {
  @ApiProperty({
    description: `phone`,
    example: '+998998887766',
  })
  @IsNotEmpty()
  @IsString()
  @Transform(({ value }) => formatPhoneNumber(value))
  phone: string;
}

export default PhoneDto;
