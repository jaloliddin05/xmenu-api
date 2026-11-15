import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { DELIVERY_PRICE_STEPS } from 'src/modules/branch/domain/delivery-pricing';

export const COURIER_MODES = ['own', 'external', 'both'] as const;

export class UpdateOrderSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  readonly minOrderPickup?: number;
  @ApiPropertyOptional({
    enum: DELIVERY_PRICE_STEPS,
    description: 'Delivery fees are rounded up to this step (sum)',
  })
  @IsOptional()
  @IsIn(DELIVERY_PRICE_STEPS)
  readonly deliveryPriceStep?: number;
  @ApiPropertyOptional({
    enum: COURIER_MODES,
    description:
      'Who delivers: own couriers, external services or both. external: cash on delivery is not offered',
  })
  @IsOptional()
  @IsIn(COURIER_MODES)
  readonly courierMode?: (typeof COURIER_MODES)[number];
  @ApiPropertyOptional({
    description: 'Restoran qabul qilmasa avto-bekor (soniya), 60..3600',
  })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(3600)
  readonly acceptanceTimeoutSeconds?: number;
  @ApiPropertyOptional({
    description: "Onlayn to'lov oynasi (soniya), 120..7200",
  })
  @IsOptional()
  @IsInt()
  @Min(120)
  @Max(7200)
  readonly paymentTimeoutSeconds?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  readonly maxActiveOrders?: number;
}
