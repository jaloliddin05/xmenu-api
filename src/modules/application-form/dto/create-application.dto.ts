import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApplicationFrom } from '@prisma/client';

export class CreateApplicationDto {
  @ApiProperty({
          description: `fullName`,
          example: '',
          required: false,
  })
  @IsString()
  @IsOptional()
  fullName: string;

  @ApiProperty({
        description: `phone`,
        example: '',
        required: false,
  })
  @IsString()
  @IsOptional()
  phone: string;

  @ApiProperty({
        description: `from`,
        example: '',
        required: false,
  })
  @IsEnum(ApplicationFrom)
  @IsOptional()
  from: ApplicationFrom;

  @ApiProperty({
        description: `description`,
        example: '',
        required: false,
  })
  @IsString()
  @IsOptional()
  description: string;
}
