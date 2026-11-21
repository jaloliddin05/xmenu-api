import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class StaffStepUpDto {
  @ApiProperty({ description: 'Current password of the owner' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  readonly password: string;
}

export class StaffStepUpTokenDto {
  @ApiProperty({
    description:
      'Send as X-Step-Up-Token on critical actions; valid for this login only, any number of times until it expires',
  })
  stepUpToken: string;

  @ApiProperty({ example: 300, description: 'Seconds until it expires' })
  expiresIn: number;
}
