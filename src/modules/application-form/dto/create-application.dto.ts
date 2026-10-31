import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApplicationFrom } from '@prisma/client';

/** Landing contact form (public). Column limits follow `application` in prisma; `from` is NOT NULL there. */
export class CreateApplicationDto {
  @ApiPropertyOptional({ maxLength: 120, example: 'Aziz Karimov' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional({ maxLength: 32, example: '+998901234567' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ maxLength: 64, example: 'basic' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  plan?: string;

  @ApiProperty({ enum: ApplicationFrom, example: ApplicationFrom.web })
  @IsEnum(ApplicationFrom)
  from: ApplicationFrom;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
