import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

class UpdateCustomerDto {
  @ApiProperty({ description: 'name (2-50 belgi)', example: 'Ali' })
  @IsString()
  readonly name: string;
}

export default UpdateCustomerDto;
