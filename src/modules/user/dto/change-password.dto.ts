import { IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class ChangePasswordDto {
  @ApiProperty({
    description: `old password`,
    example: '12345',
  })
  @IsNotEmpty()
  @IsString()
  readonly oldPassword: string;

  @ApiProperty({
    description: `new password, 8-72 characters`,
    example: 'correct horse battery',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @Length(8, 72)
  readonly newPassword: string;
}

export default ChangePasswordDto;
