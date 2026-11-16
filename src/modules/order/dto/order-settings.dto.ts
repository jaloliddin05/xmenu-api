import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { DELIVERY_PRICE_STEPS } from 'src/modules/branch/domain/delivery-pricing';

export const COURIER_MODES = ['own', 'external', 'both'] as const;

/** Courier pay: per delivery plus every started km (straight line) over includedKm. */
export class PayRateDto {
  @ApiProperty({ description: 'Sum per delivery', example: 10000 })
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  readonly perDelivery: number;
  @ApiProperty({ description: 'Km included in the rate', example: 3 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  readonly includedKm: number;
  @ApiProperty({
    description: 'Sum per started km over includedKm',
    example: 2000,
  })
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  readonly perKm: number;
}

/** Payment methods offered at delivery (pickup: cash always, online with keys). */
export class DeliveryPaymentDto {
  @ApiProperty({
    description:
      'Cash to the courier. Not offered while only external services deliver',
  })
  @IsBoolean()
  readonly cash: boolean;
  @ApiProperty({
    description:
      'A card to the courier at the door. Not offered while only external services deliver',
  })
  @IsBoolean()
  readonly card: boolean;
  @ApiProperty({
    description:
      'Online (Click, Payme). Switching it on needs a connected provider: 400 invalid_settings, field code online_payment_not_connected',
  })
  @IsBoolean()
  readonly online: boolean;
}

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
    type: DeliveryPaymentDto,
    description:
      'Payment methods at delivery, all three at once. None on: 400 invalid_settings, field code delivery_payment_required',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryPaymentDto)
  readonly deliveryPayment?: DeliveryPaymentDto;
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
  @ApiPropertyOptional({
    description:
      'Remind the courier and the operator when "picked up" is not pressed this long after "ready" (minutes), 1..60',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  readonly pickupReminderMinutes?: number;
  @ApiPropertyOptional({
    description:
      'Alert the operator when an order is on the way longer (minutes), 10..480',
  })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(480)
  readonly onTheWayAlertMinutes?: number;
  @ApiPropertyOptional({
    description:
      'Wait at the door after "no answer", then the operator decides (minutes), 1..60',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  readonly doorWaitMinutes?: number;
  @ApiPropertyOptional({
    type: PayRateDto,
    nullable: true,
    description:
      'Courier pay rate of the venue; null removes it (no pay accrued)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PayRateDto)
  readonly courierPay?: PayRateDto | null;
}

export class OrderSettingsViewDto {
  @ApiProperty() readonly minOrderPickup: number;
  @ApiProperty({ enum: DELIVERY_PRICE_STEPS })
  readonly deliveryPriceStep: number;
  @ApiProperty({ enum: COURIER_MODES }) readonly courierMode: string;
  @ApiProperty({ type: DeliveryPaymentDto })
  readonly deliveryPayment: DeliveryPaymentDto;
  @ApiProperty() readonly acceptanceTimeoutSeconds: number;
  @ApiProperty() readonly paymentTimeoutSeconds: number;
  @ApiProperty() readonly maxActiveOrders: number;
  @ApiProperty() readonly pickupReminderMinutes: number;
  @ApiProperty() readonly onTheWayAlertMinutes: number;
  @ApiProperty() readonly doorWaitMinutes: number;
  @ApiProperty({ type: PayRateDto, nullable: true })
  readonly courierPay: PayRateDto | null;
}
