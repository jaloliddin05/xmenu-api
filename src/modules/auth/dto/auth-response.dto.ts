import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CustomerUser } from 'src/modules/customer/services/customer.service';
import type { StaffUser } from 'src/infra/helper/auth/staff-user';

// ---------------------------------------------------------------- customer

export class CustomerUserDto implements CustomerUser {
  @ApiProperty() id: string;
  @ApiProperty({ example: '+998901234567' }) phone: string;
  @ApiProperty({ example: 'Ali' }) name: string;
}

export class CustomerTokenPairDto {
  @ApiProperty({ description: 'JWT, send as Authorization: Bearer' })
  accessToken: string;
  @ApiProperty({
    description: 'Opaque, single use: POST /auth/customer/refresh rotates it',
  })
  refreshToken: string;
}

/** register: the new customer is signed in. */
export class CustomerSessionDto extends CustomerTokenPairDto {
  @ApiProperty({ type: CustomerUserDto }) user: CustomerUserDto;
}

/** otp/verify (and Telegram verification) for a known phone. */
export class CustomerSignedInDto extends CustomerSessionDto {
  @ApiProperty({ enum: [false] }) isNewUser: false;
}

/** otp/verify for a new phone: finish with POST /auth/customer/register. */
export class CustomerRegistrationRequiredDto {
  @ApiProperty({ enum: [true] }) isNewUser: true;
  @ApiProperty({
    description: 'One-time token for POST /auth/customer/register',
  })
  registrationToken: string;
}

/** login by Telegram initData for a Telegram user not linked yet: verify the phone first. */
export class CustomerPhoneRequiredDto {
  @ApiProperty({ enum: [true] }) isNewUser: true;
  @ApiProperty({ enum: [true] }) requiresPhone: true;
}

// ---------------------------------------------------------------- staff

class StaffFileDto {
  @ApiProperty() id: string;
  @ApiProperty() url: string;
}

class StaffOrganizationTranslationDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'ru' }) lang: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
}

class StaffOrganizationDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) slug: string | null;
  @ApiProperty({ example: 'restaurant' }) type: string;
  @ApiProperty() is_active: boolean;
  @ApiPropertyOptional({ type: StaffFileDto, nullable: true })
  logo?: StaffFileDto | null;
  @ApiPropertyOptional({ type: StaffFileDto, nullable: true })
  banner?: StaffFileDto | null;
  @ApiPropertyOptional({ type: [StaffOrganizationTranslationDto] })
  translations?: StaffOrganizationTranslationDto[];
}

export class StaffUserDto implements StaffUser {
  @ApiProperty() id: string;
  @ApiProperty({ example: '+998901234567' }) phone: string;
  @ApiProperty({ type: String, nullable: true }) email: string | null;
  @ApiProperty({ type: String, nullable: true }) first_name: string | null;
  @ApiProperty({ type: String, nullable: true }) last_name: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Avatar URL' })
  url: string | null;
  @ApiProperty() isActive: boolean;
  @ApiProperty() created_at: Date;
  @ApiProperty({ type: String, nullable: true }) avatar_id: string | null;
  @ApiPropertyOptional({ type: StaffOrganizationDto, nullable: true })
  organization?: StaffOrganizationDto | null;
}

export class StaffTokenPairDto {
  @ApiProperty({
    description:
      'JWT, send as Authorization: Bearer (lifetime JWT_ACCESS_TOKEN_EXPIRATION_TIME)',
  })
  accessToken: string;
  @ApiProperty({
    description:
      'Opaque, single use: POST /auth/refresh rotates it, POST /auth/logout revokes it',
  })
  refreshToken: string;
}

export class StaffLoginResponseDto extends StaffTokenPairDto {
  @ApiProperty({ type: StaffUserDto }) user: StaffUserDto;
}

export class StaffCheckCodeResponseDto extends StaffLoginResponseDto {
  @ApiProperty({ enum: [true] }) success: true;
}

export class StaffRegisterResponseDto {
  @ApiProperty({ description: 'Pass to check-code and resend-code' })
  registrationId: string;
  @ApiProperty({
    example: 60,
    description: 'Seconds until a new code may be requested',
  })
  resendAfter: number;
  @ApiProperty({ example: 6 }) codeLength: number;
  @ApiProperty({ example: 300, description: 'Code lifetime in seconds' })
  expiresIn: number;
}

export class StaffResendCodeResponseDto {
  @ApiProperty({ example: 60 }) resendAfter: number;
  @ApiProperty({ example: 300 }) expiresIn: number;
}
