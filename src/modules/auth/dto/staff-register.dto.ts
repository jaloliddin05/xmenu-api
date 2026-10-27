import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import formatPhoneNumber from 'src/infra/helper/auth/format-phone';
import { OrganizationTypeEnum } from 'src/modules/organization/models/organization.model';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class StaffRegisterDto {
  @ApiProperty({ example: '+998901234567', description: 'Owner phone, E.164 (+998...)' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? formatPhoneNumber(value) : value))
  readonly phone: string;

  @ApiProperty({ example: 'correct horse battery', minLength: 8, maxLength: 72 })
  @IsString()
  @Length(8, 72)
  readonly password: string;

  @ApiProperty({ example: 'Mant', description: 'Venue name; the slug is derived from it' })
  @IsString()
  @Transform(trim)
  @Length(1, 100)
  readonly name: string;

  @ApiProperty({ enum: OrganizationTypeEnum, example: OrganizationTypeEnum.Cafe })
  @IsEnum(OrganizationTypeEnum)
  readonly type: OrganizationTypeEnum;

  @ApiProperty({ example: 'Aziz' })
  @IsString()
  @Transform(trim)
  @Length(1, 100)
  readonly first_name: string;

  @ApiPropertyOptional({ example: 'Karimov' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(100)
  readonly last_name?: string;
}

export class StaffRegistrationRefDto {
  @ApiProperty({ example: '6f1c2a3e-1b2c-4d5e-8f90-1a2b3c4d5e6f', description: 'From POST /auth/register' })
  @IsUUID()
  readonly registrationId: string;
}

export class StaffCheckCodeDto extends StaffRegistrationRefDto {
  @ApiProperty({ example: '123456', description: 'SMS code, digits as a string (length = OTP_LENGTH)' })
  @IsString()
  readonly code: string;
}
