import { IsNotEmpty, IsString } from 'class-validator';
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
    description: `new password`,
    example: '54321',
  })
  @IsNotEmpty()
  @IsString()
  readonly newPassword: string;
}

export default ChangePasswordDto;
