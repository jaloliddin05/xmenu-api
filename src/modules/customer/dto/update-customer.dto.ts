import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

class UpdateCustomerDto {
  @ApiPropertyOptional({ description: 'name (2-50 belgi)', example: 'Ali' })
  @IsOptional()
  @IsString()
  readonly name?: string;

  @ApiPropertyOptional({
    description:
      'Preferred language of SMS and order notifications: ru, uz or en, one of the venue languages (422 language_not_supported otherwise)',
    enum: ['ru', 'uz', 'en'],
  })
  @IsOptional()
  @IsString()
  readonly language?: string;
}

export default UpdateCustomerDto;
