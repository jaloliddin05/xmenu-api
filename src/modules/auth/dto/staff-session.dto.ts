import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class StaffRefreshDto {
  @ApiProperty({
    description:
      'Refresh token from login, check-code or the previous refresh (single use)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken: string;
}

export class StaffLogoutDto {
  // Idempotent: 204 even without a token
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  refreshToken?: string;
}
