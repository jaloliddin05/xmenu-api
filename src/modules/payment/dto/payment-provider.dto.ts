import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional } from 'class-validator';

export class UpsertPaymentProviderDto {
  @ApiProperty({
    description: "click: { merchantId, serviceId, merchantUserId, secretKey } · payme: { merchantId, key }. Javoblarda hech qachon qaytarilmaydi.",
    example: { merchantId: '12345', key: 'payme-secret-key' },
  })
  @IsObject()
  readonly config: Record<string, unknown>;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  readonly isEnabled?: boolean;
}
