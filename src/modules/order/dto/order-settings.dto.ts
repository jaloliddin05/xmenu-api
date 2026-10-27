import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateOrderSettingsDto {
  @ApiPropertyOptional({ description: "Yetkazib berish uchun xizmat to'lovi (so'm)" }) @IsOptional() @IsInt() @Min(0) @Max(10_000_000)
  readonly deliveryServiceFee?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000_000) readonly minOrderDelivery?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000_000) readonly minOrderPickup?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(600) readonly etaMin?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(600) readonly etaMax?: number;
  @ApiPropertyOptional({ description: "Restoran qabul qilmasa avto-bekor (soniya), 60..3600" }) @IsOptional() @IsInt() @Min(60) @Max(3600)
  readonly acceptanceTimeoutSeconds?: number;
  @ApiPropertyOptional({ description: "Onlayn to'lov oynasi (soniya), 120..7200" }) @IsOptional() @IsInt() @Min(120) @Max(7200)
  readonly paymentTimeoutSeconds?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(50) readonly maxActiveOrders?: number;
  @ApiPropertyOptional({ description: '[[lat,lng], ...] kamida 3 nuqta; null — zona tekshirilmaydi', nullable: true })
  @IsOptional() @IsArray()
  readonly deliveryZone?: number[][] | null;
}
