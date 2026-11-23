import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AREA_PART_SOURCES,
  type AreaPartSource,
  MAX_CUSTOM_PARTS,
  MAX_CUSTOM_POINTS,
  MAX_REGION_PARTS,
  MIN_CUSTOM_POINTS,
} from '../domain/delivery-area';
import { MAX_DELIVERY_KM, MAX_FEE, MAX_SUM } from './delivery-pricing.dto';

const RINGS_SCHEMA = {
  type: 'array',
  items: {
    type: 'array',
    items: {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
    },
  },
} as const;

/** The venue default price: addresses in the area that no branch rule covers (docs/DELIVERY.md). */
export class DeliveryDefaultRuleDto {
  @ApiProperty({ example: 10000, description: 'Price up to includedKm (sum)' })
  @IsInt()
  @Min(0)
  @Max(MAX_FEE)
  readonly basePrice: number;

  @ApiProperty({
    example: 3,
    description: 'Kilometres in the base price, straight line from the branch',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_DELIVERY_KM)
  readonly includedKm: number;

  @ApiProperty({
    example: 2000,
    description: 'Added for every started kilometre over includedKm (sum)',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_FEE)
  readonly pricePerKm: number;

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
    example: null,
    description: 'Free delivery from this subtotal; null: never free',
  })
  @ValidateIf((_o, value: unknown) => value !== null && value !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_SUM)
  readonly freeFrom?: number | null;
}

/** One part of the area as the owner sends it: a catalog region by code, or a drawn outline. */
export class DeliveryAreaPartDto {
  @ApiProperty({ enum: AREA_PART_SOURCES, example: 'region' })
  @IsIn(AREA_PART_SOURCES)
  readonly source: AreaPartSource;

  @ApiPropertyOptional({
    example: 'UZ-TK',
    description:
      'source region: ISO 3166-2:UZ code from GET /delivery/regions (the server copies the geometry)',
  })
  @ValidateIf((o: DeliveryAreaPartDto) => o.source === 'region')
  @IsString()
  @MaxLength(10)
  readonly code?: string;

  @ApiPropertyOptional({
    type: 'array',
    items: {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
    },
    minItems: MIN_CUSTOM_POINTS,
    maxItems: MAX_CUSTOM_POINTS,
    example: [
      [41.35, 69.2],
      [41.35, 69.35],
      [41.25, 69.3],
    ],
    description:
      'source custom: one outline [[lat, lng], ...], 3 to 200 points, open, no holes; rounded to 6 decimals',
  })
  @ValidateIf((o: DeliveryAreaPartDto) => o.source === 'custom')
  @IsArray()
  @ArrayMinSize(MIN_CUSTOM_POINTS)
  @ArrayMaxSize(MAX_CUSTOM_POINTS)
  readonly polygon?: number[][];
}

/**
 * PUT /organization/:id/delivery-area: replaces the area as a whole. No parts: the venue has no area (delivery
 * prices by branch rules only, as before). Parts need the default rule.
 */
export class DeliveryAreaDto {
  @ApiProperty({
    type: [DeliveryAreaPartDto],
    maxItems: MAX_REGION_PARTS + MAX_CUSTOM_PARTS,
    description: `At most ${MAX_REGION_PARTS} regions and ${MAX_CUSTOM_PARTS} drawn parts`,
  })
  @IsArray()
  @ArrayMaxSize(MAX_REGION_PARTS + MAX_CUSTOM_PARTS)
  @ValidateNested({ each: true })
  @Type(() => DeliveryAreaPartDto)
  readonly parts: DeliveryAreaPartDto[];

  @ApiPropertyOptional({
    type: DeliveryDefaultRuleDto,
    nullable: true,
    description: 'Required when parts is not empty',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryDefaultRuleDto)
  readonly defaultRule?: DeliveryDefaultRuleDto | null;
}

export class RegionNameDto {
  @ApiProperty({ example: 'Toshkent shahri' }) uz: string;
  @ApiProperty({ example: 'Ташкент' }) ru: string;
  @ApiProperty({ example: 'Tashkent City' }) en: string;
}

const BBOX_SCHEMA = {
  type: 'array',
  items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
  minItems: 2,
  maxItems: 2,
  example: [
    [41.17, 69.11],
    [41.45, 69.5],
  ],
  description: '[[south, west], [north, east]]',
} as const;

/** A stored part of the venue area (GET and PUT answer). */
export class DeliveryAreaPartViewDto {
  @ApiProperty({ enum: AREA_PART_SOURCES }) source: AreaPartSource;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'UZ-TK',
    description: 'Region code; null for a drawn part',
  })
  code: string | null;
  @ApiProperty({
    type: RegionNameDto,
    nullable: true,
    description: 'Region name; null for a drawn part',
  })
  name: RegionNameDto | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'osm-2026-11-24',
    description:
      'Catalog version the region was copied from; null for a drawn part',
  })
  catalogVersion: string | null;
  @ApiProperty({
    ...RINGS_SCHEMA,
    description:
      'Rings [[[lat, lng], ...], ...], open; a point is inside by the even-odd rule over all of them. A drawn part has one ring; a region its copy from the catalog',
  })
  rings: number[][][];
}

export class DeliveryAreaViewDto {
  @ApiProperty({ type: [DeliveryAreaPartViewDto] })
  parts: DeliveryAreaPartViewDto[];
  @ApiProperty({ type: DeliveryDefaultRuleDto, nullable: true })
  defaultRule: DeliveryDefaultRuleDto | null;
}

export class RegionSummaryDto {
  @ApiProperty({ example: 'UZ-TK', description: 'ISO 3166-2:UZ' })
  code: string;
  @ApiProperty({ type: RegionNameDto }) name: RegionNameDto;
  @ApiProperty(BBOX_SCHEMA) bbox: number[][];
}

/** GET /delivery/regions */
export class RegionListDto {
  @ApiProperty({ example: 'osm-2026-11-24' }) version: string;
  @ApiProperty({
    example: '© OpenStreetMap contributors',
    description: 'Show next to a map drawing the regions',
  })
  attribution: string;
  @ApiProperty({ example: 'ODbL-1.0' }) license: string;
  @ApiProperty({ type: [RegionSummaryDto] }) regions: RegionSummaryDto[];
}

/** GET /delivery/regions/:code */
export class RegionDto extends RegionSummaryDto {
  @ApiProperty({ example: 'osm-2026-11-24' }) version: string;
  @ApiProperty({
    ...RINGS_SCHEMA,
    description:
      'Rings [[[lat, lng], ...], ...], open, even-odd (outlines, holes, exclaves)',
  })
  rings: number[][][];
}

/** GET /delivery/area: what the guest map draws. */
export class PublicDeliveryAreaDto {
  @ApiProperty({
    type: 'array',
    nullable: true,
    items: RINGS_SCHEMA,
    description:
      'Parts, each a list of rings [[lat, lng], ...] (5 decimals, open, even-odd); null: the venue has no area',
  })
  parts: number[][][][] | null;
}
