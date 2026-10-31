import { ApiProperty } from '@nestjs/swagger';
import { LANGS } from 'src/infra/http/request-helpers';
import type { Lang } from 'src/infra/http/request-helpers';
import { ThemeDto } from 'src/modules/organization/dto/organization-settings.dto';
import { SUPPORTED_CURRENCIES } from 'src/modules/organization/domain/organization-settings';
import { DELIVERY_MODES } from 'src/modules/organization/domain/publication';
import type { DeliveryMode } from 'src/modules/organization/domain/publication';
import type {
  Bounds,
  LatLng,
} from 'src/modules/organization/domain/organization-settings';

export const FULFILLMENT_MODES = ['delivery', 'pickup'] as const;
export type FulfillmentMode = (typeof FULFILLMENT_MODES)[number];

const LAT_LNG = {
  type: 'array',
  items: { type: 'number' },
  minItems: 2,
  maxItems: 2,
} as const;

export class TenantLocaleDto {
  @ApiProperty({ enum: LANGS, example: 'ru' })
  defaultLanguage: Lang;

  @ApiProperty({ enum: LANGS, isArray: true, example: ['ru', 'uz', 'en'] })
  languages: Lang[];

  @ApiProperty({ enum: SUPPORTED_CURRENCIES, example: 'UZS' })
  currency: string;
}

export class TenantContactsDto {
  @ApiProperty({ type: String, nullable: true, example: '+998711234567' })
  phone: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'demo_cafe',
    description: 'Without @',
  })
  telegramUsername: string | null;

  @ApiProperty({ type: String, nullable: true, example: '10:00-23:00' })
  workingHours: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Main street 1' })
  address: string | null;
}

export class TenantDeliveryChannelDto {
  @ApiProperty({
    example: true,
    description:
      'The owner turned ordering on (website and/or Mini App, delivery and pickup)',
  })
  enabled: boolean;

  @ApiProperty({
    enum: DELIVERY_MODES,
    example: 'site',
    description: 'site: {slug}.xmenu.uz; miniapp: the Telegram Mini App; both',
  })
  mode: DeliveryMode;

  @ApiProperty({
    example: true,
    description:
      'Orders are open: enabled and published. false = never published or paused by the owner; POST /orders answers 422',
  })
  published: boolean;
}

export class TenantChannelsDto {
  @ApiProperty({
    example: true,
    description: 'QR menu turned on by the owner',
  })
  qr: boolean;

  @ApiProperty({ type: TenantDeliveryChannelDto })
  delivery: TenantDeliveryChannelDto;
}

export class TenantFulfillmentDto {
  @ApiProperty({
    enum: FULFILLMENT_MODES,
    isArray: true,
    description:
      'Empty unless channels.delivery.published. pickup: an active branch accepts pickup. delivery: an active branch accepts delivery and a delivery zone is set. Empty without branches',
  })
  modes: FulfillmentMode[];

  @ApiProperty({
    enum: FULFILLMENT_MODES,
    nullable: true,
    description: 'First of modes; null when modes is empty',
  })
  defaultMode: FulfillmentMode | null;
}

export class TenantMapDto {
  @ApiProperty({
    ...LAT_LNG,
    nullable: true,
    example: [41.311081, 69.240562],
    description: '[lat, lng]',
  })
  center: LatLng | null;

  @ApiProperty({ type: Number, nullable: true, example: 15 })
  zoom: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'Tashkent' })
  city: string | null;

  @ApiProperty({
    type: 'array',
    items: LAT_LNG,
    nullable: true,
    example: [
      [41.15, 69.0],
      [41.45, 69.45],
    ],
    description: '[[southWestLat, southWestLng], [northEastLat, northEastLng]]',
  })
  bounds: Bounds | null;

  @ApiProperty({
    type: 'array',
    items: LAT_LNG,
    nullable: true,
    example: [
      [41.361, 69.201],
      [41.37, 69.28],
      [41.345, 69.33],
    ],
    description:
      'Delivery polygon [[lat, lng], ...]; null = delivery unavailable',
  })
  deliveryZone: LatLng[] | null;
}

/** GET /tenant/config: everything a front-end needs to brand and set itself up for one venue. */
export class TenantConfigDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'cafe-example' })
  slug: string;

  @ApiProperty({ example: 'Demo Cafe' })
  name: string;

  @ApiProperty({
    enum: ['restaurant', 'cafe', 'fast_food', 'coffee_shop', 'other'],
  })
  type: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Absolute URL (PUBLIC_FILES_URL)',
  })
  logoUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Absolute URL (PUBLIC_FILES_URL)',
  })
  bannerUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "In the response language, else the venue's default language, else null",
  })
  description: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 2015 })
  foundedYear: number | null;

  @ApiProperty({
    type: ThemeDto,
    nullable: true,
    description:
      'Brand colors; a missing key (or null theme) means the front-end neutral value',
  })
  theme: ThemeDto | null;

  @ApiProperty({ type: TenantLocaleDto })
  locale: TenantLocaleDto;

  @ApiProperty({ type: TenantContactsDto })
  contacts: TenantContactsDto;

  @ApiProperty({ type: TenantChannelsDto })
  channels: TenantChannelsDto;

  @ApiProperty({ type: TenantFulfillmentDto })
  fulfillment: TenantFulfillmentDto;

  @ApiProperty({ type: TenantMapDto })
  map: TenantMapDto;
}
