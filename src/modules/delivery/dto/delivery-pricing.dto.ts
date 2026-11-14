import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const MAX_ZONES = 20;
export const MAX_ZONE_POINTS = 200;
export const MAX_DELIVERY_KM = 100;
const MAX_FEE = 10_000_000;
const MAX_SUM = 100_000_000;

/** Missing or null: no free delivery. */
const FreeFrom = () =>
  ValidateIf((_o, value: unknown) => value !== null && value !== undefined);

export class DeliveryZoneDto {
  @ApiProperty({
    type: 'array',
    items: {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
    },
    minItems: 3,
    maxItems: MAX_ZONE_POINTS,
    example: [
      [41.3, 69.2],
      [41.3, 69.3],
      [41.35, 69.25],
    ],
    description: '[[lat, lng], ...], 3 to 200 points',
  })
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(MAX_ZONE_POINTS)
  readonly polygon: number[][];

  @ApiProperty({ example: 10000, description: 'Delivery fee (sum)' })
  @IsInt()
  @Min(0)
  @Max(MAX_FEE)
  readonly price: number;

  @ApiProperty({
    example: 50000,
    description: 'Minimum order subtotal without delivery (sum)',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_SUM)
  readonly minOrder: number;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 150000,
    description: 'Free delivery from this subtotal; null: never free',
  })
  @FreeFrom()
  @IsInt()
  @Min(0)
  @Max(MAX_SUM)
  readonly freeFrom?: number | null;
}

export class DeliveryDistanceDto {
  @ApiProperty({ example: 8000, description: 'Price up to includedKm (sum)' })
  @IsInt()
  @Min(0)
  @Max(MAX_FEE)
  readonly basePrice: number;

  @ApiProperty({ example: 2, description: 'Kilometres in the base price' })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_DELIVERY_KM)
  readonly includedKm: number;

  @ApiProperty({
    example: 1500,
    description: 'Added for every started kilometre over includedKm (sum)',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_FEE)
  readonly pricePerKm: number;

  @ApiProperty({
    example: 10,
    description:
      'Farthest delivery in a straight line (km), inclusive; not less than includedKm',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.1)
  @Max(MAX_DELIVERY_KM)
  readonly maxKm: number;

  @ApiProperty({ example: 50000 })
  @IsInt()
  @Min(0)
  @Max(MAX_SUM)
  readonly minOrder: number;

  @ApiPropertyOptional({ type: Number, nullable: true, example: null })
  @FreeFrom()
  @IsInt()
  @Min(0)
  @Max(MAX_SUM)
  readonly freeFrom?: number | null;
}

/**
 * Delivery pricing of one branch, replaced as a whole. Zones in priority order: where they overlap the first
 * one applies. The distance rule prices addresses outside every zone. No zones and no distance rule: the
 * branch does not deliver.
 */
export class DeliveryPricingDto {
  @ApiProperty({ type: [DeliveryZoneDto], maxItems: MAX_ZONES })
  @IsArray()
  @ArrayMaxSize(MAX_ZONES)
  @ValidateNested({ each: true })
  @Type(() => DeliveryZoneDto)
  readonly zones: DeliveryZoneDto[];

  @ApiPropertyOptional({ type: DeliveryDistanceDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryDistanceDto)
  readonly distance?: DeliveryDistanceDto | null;
}

/** The stored pricing (GET and PUT answer). */
export class DeliveryPricingViewDto {
  @ApiProperty({ type: [DeliveryZoneDto] }) zones: DeliveryZoneDto[];
  @ApiProperty({ type: DeliveryDistanceDto, nullable: true })
  distance: DeliveryDistanceDto | null;
}

export class DeliveryPointQueryDto {
  @ApiProperty({ example: 41.31 })
  @Type(() => Number)
  @IsLatitude()
  readonly lat: number;

  @ApiProperty({ example: 69.25 })
  @Type(() => Number)
  @IsLongitude()
  readonly lng: number;

  @ApiPropertyOptional({
    example: 60000,
    description: 'Order subtotal without delivery (sum); 0 when omitted',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_SUM)
  readonly subtotal?: number;
}

const RULES = ['zone', 'distance'] as const;

/** GET /branch/:id/delivery-pricing/check: what this branch charges for the address, hours not considered. */
export class DeliveryPriceCheckDto {
  @ApiProperty({ description: 'The branch delivers to the address' })
  covered: boolean;
  @ApiProperty({ enum: RULES, nullable: true })
  rule: 'zone' | 'distance' | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Index in zones; null for the distance rule',
  })
  zoneIndex: number | null;
  @ApiProperty({ example: 3.21, description: 'Straight line, km (0.01)' })
  distanceKm: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Rounded up to the venue step; 0 when free',
  })
  deliveryFee: number | null;
  @ApiProperty({ type: Number, nullable: true }) freeFrom: number | null;
  @ApiProperty({ type: Number, nullable: true }) minOrder: number | null;
  @ApiProperty({ description: 'How much the subtotal misses to minOrder' })
  shortBy: number;
}

export class QuoteBranchDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() address: string;
}

export const QUOTE_REASONS = [
  'ordering_channel_disabled',
  'ordering_not_published',
  'fulfillment_unavailable',
  'delivery_not_configured',
  'out_of_delivery_zone',
  'branch_closed',
  'branch_hours_not_set',
  'min_order_not_reached',
] as const;
export type QuoteReason = (typeof QUOTE_REASONS)[number];

/** GET /delivery/quote: the delivery price for the cart, the same rules and choice as POST /orders. */
export class DeliveryQuoteDto {
  @ApiProperty({
    description: 'A branch delivers to the address now (the minimum aside)',
  })
  available: boolean;
  @ApiProperty({
    description: 'available and the subtotal reaches the minimum',
  })
  canOrder: boolean;
  @ApiProperty({
    enum: QUOTE_REASONS,
    nullable: true,
    description:
      'Error code (docs/ERRORS.md) explaining why the order cannot be placed; null when canOrder',
  })
  reason: QuoteReason | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'With branch_closed: the earliest opening, ISO 8601 with date and offset (null: none in 7 days)',
  })
  opensAt: string | null;
  @ApiProperty({ type: QuoteBranchDto, nullable: true })
  branch: QuoteBranchDto | null;
  @ApiProperty({ enum: RULES, nullable: true }) rule:
    | 'zone'
    | 'distance'
    | null;
  @ApiProperty({ type: Number, nullable: true, example: 3.21 })
  distanceKm: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 12000,
    description:
      'Rounded up to the venue step, 0 when free; send it as expectedDeliveryFee',
  })
  deliveryFee: number | null;
  @ApiProperty({ type: Number, nullable: true, example: 150000 })
  freeFrom: number | null;
  @ApiProperty({ type: Number, nullable: true, example: 50000 })
  minOrder: number | null;
  @ApiProperty({ example: 0, description: 'How much the subtotal misses' })
  shortBy: number;
}
