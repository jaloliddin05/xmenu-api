import { ApiProperty } from '@nestjs/swagger';

/** POST /auth/customer/otp/request */
export class CustomerOtpRequestResponseDto {
  @ApiProperty({
    example: 60,
    description: 'Seconds until a new code may be requested',
  })
  resendAfter: number;

  @ApiProperty({ example: 6, description: 'Digits in the code (OTP_LENGTH)' })
  codeLength: number;
}
