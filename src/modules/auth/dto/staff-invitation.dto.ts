import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';
import formatPhoneNumber from 'src/infra/helper/auth/format-phone';

const toPhone = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? formatPhoneNumber(value) : value;

export class StaffInvitationCodeDto {
  @ApiProperty({ example: '+998901234567', description: 'The invited phone' })
  @IsString()
  @IsNotEmpty()
  @Transform(toPhone)
  readonly phone: string;
}

export class StaffInvitationAcceptDto {
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
  readonly password: string;
}
