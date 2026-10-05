import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CustomerRefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}

export class CustomerLogoutDto {
  // Logout idempotent: token bo'lmasa ham 204
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
