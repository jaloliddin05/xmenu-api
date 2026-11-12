import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';
import formatPhoneNumber from 'src/infra/helper/auth/format-phone';

const toPhone = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? formatPhoneNumber(value) : value;

export class StaffForgotPasswordDto {
  @ApiProperty({ example: '+998901234567', description: 'Owner phone' })
  @IsString()
  @IsNotEmpty()
  @Transform(toPhone)
  readonly phone: string;
}

export class StaffResetPasswordDto {
  @ApiProperty({ example: '+998901234567' })
  @IsString()
  @IsNotEmpty()
  @Transform(toPhone)
  readonly phone: string;

  @ApiProperty({ example: '123456', description: 'Code from the SMS' })
  @IsString()
  @MaxLength(16)
  readonly code: string;

  @ApiProperty({
    minLength: 8,
    maxLength: 72,
    example: 'correct horse battery',
  })
  @IsString()
  @Length(8, 72)
  readonly newPassword: string;
}

export class StaffChangePasswordDto {
  @ApiProperty({ description: 'Current password' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  readonly currentPassword: string;

  @ApiProperty({
    minLength: 8,
    maxLength: 72,
    example: 'correct horse battery',
  })
  @IsString()
  @Length(8, 72)
  readonly newPassword: string;
}
