import { ApiProperty } from '@nestjs/swagger';
import { LANGS } from 'src/infra/http/request-helpers';
import type { Lang } from 'src/infra/http/request-helpers';
import { FullThemeDto } from 'src/modules/organization/dto/organization-settings.dto';
import { SUPPORTED_CURRENCIES } from 'src/modules/organization/domain/organization-settings';
import { DELIVERY_MODES } from 'src/modules/organization/domain/publication';
import type { DeliveryMode } from 'src/modules/organization/domain/publication';
import type {
  Bounds,
  LatLng,
} from 'src/modules/organization/domain/organization-settings';

import { MAP_CENTER_SOURCES } from '../map-view';
import { COURIER_MODES } from 'src/modules/order/dto/order-settings.dto';
import type { MapCenterSource } from '../map-view';

export const FULFILLMENT_MODES = ['delivery', 'pickup'] as const;
export type FulfillmentMode = (typeof FULFILLMENT_MODES)[number];

export const DELIVERY_UNAVAILABLE_REASONS = [
  'not_offered',
  'channel_disabled',
  'not_published',
  'not_configured',
] as const;
export type DeliveryUnavailableReason =
  (typeof DELIVERY_UNAVAILABLE_REASONS)[number];

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

  @ApiProperty({
    example: false,
    description:
      'The venue has a Mini App: mode miniapp or both and its Telegram bot works (channels.auth.telegram). ' +
      'Mode miniapp takes sign-in and orders only inside it (X-Telegram-Init-Data)',
  })
  miniApp: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'mant_cafe_bot',
    description:
      'Username of the venue bot when miniApp, for the «Открыть в Telegram» link https://t.me/<botUsername>; null otherwise',
  })
  botUsername: string | null;
}

/**
 * How a customer can confirm a phone: channels.auth of GET /tenant/config (cached with the config) and
 * GET /auth/customer/methods (never cached: what the sign-in sheet should use).
 */
export class TenantAuthChannelsDto {
  @ApiProperty({
    example: true,
    description:
      'The platform can send SMS codes (provider configured, or development codes in the log). A provider outage still answers 503 sms_unavailable on otp/request',
  })
  sms: boolean;

  @ApiProperty({
    example: false,
    description:
      'The venue has an enabled Telegram bot whose token the platform can read, so telegram/start can work. false = offer SMS only',
  })
  telegram: boolean;
}

export class TenantChannelsDto {
  @ApiProperty({
    example: true,
    description: 'QR menu turned on by the owner',
  })
  qr: boolean;

  @ApiProperty({
    type: TenantAuthChannelsDto,
    description:
      'Ways a customer can confirm a phone number. A hint to hide dead buttons; the endpoints stay the source of truth',
  })
  auth: TenantAuthChannelsDto;

  @ApiProperty({ type: TenantDeliveryChannelDto })
  delivery: TenantDeliveryChannelDto;
}

export class TenantFulfillmentDto {
  @ApiProperty({
    enum: FULFILLMENT_MODES,
    isArray: true,
    description:
      'Empty unless channels.delivery.published. pickup: an active branch accepts pickup. delivery: an active branch accepts delivery and has delivery pricing (a zone or the distance rule). Empty without branches',
  })
  modes: FulfillmentMode[];

  @ApiProperty({
    enum: FULFILLMENT_MODES,
    nullable: true,
    description: 'First of modes; null when modes is empty',
  })
  defaultMode: FulfillmentMode | null;

  @ApiProperty({
    example: true,
    description:
      'An active branch accepts delivery. false = the venue has no delivery by choice (hide the delivery tab); independent of publication and pricing',
  })
  deliveryOffered: boolean;

  @ApiProperty({
    example: true,
    description: 'Delivery can be ordered right now: modes contains delivery',
  })
  deliveryAvailable: boolean;

  @ApiProperty({
    enum: DELIVERY_UNAVAILABLE_REASONS,
    nullable: true,
    example: null,
    description:
      'null when deliveryAvailable. not_offered: no active branch takes delivery; channel_disabled: the owner turned ordering off; not_published: not published or paused; not_configured: no branch that takes delivery has delivery pricing. The first that applies, in this order. Whether a given address is served: GET /delivery/quote',
  })
  deliveryUnavailableReason: DeliveryUnavailableReason | null;

  @ApiProperty({
    enum: COURIER_MODES,
    example: 'own',
    description:
      'Who delivers: own couriers, external services or both (order settings)',
  })
  courierMode: (typeof COURIER_MODES)[number];

  @ApiProperty({
    example: true,
    description:
      'Cash is accepted for delivery orders; false when only external services deliver. Pickup is always payable in cash',
  })
  cashOnDelivery: boolean;
}

export class TenantMapDto {
  @ApiProperty({
    ...LAT_LNG,
    nullable: true,
    example: [41.311081, 69.240562],
    description:
      '[lat, lng]. The saved view; without one, the middle of the delivery zones, else of the branches. null only when the venue has no zone and no branch with coordinates',
  })
  center: LatLng | null;

  @ApiProperty({
    enum: MAP_CENTER_SOURCES,
    nullable: true,
    example: 'saved',
    description:
      'Where center comes from: saved (owner), zone (bounding box of the delivery zones), branches (branch coordinates); null when center is null',
  })
  centerSource: MapCenterSource | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 15,
    description:
      'Saved zoom; without one a computed zoom fitting the zone or branches (10-17) when center is computed; null for a saved center without a zoom',
  })
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
    items: { type: 'array', items: LAT_LNG },
    example: [
      [
        [41.361, 69.201],
        [41.37, 69.28],
        [41.345, 69.33],
      ],
    ],
    description:
      'Delivery zones of the active branches that take delivery, [[[lat, lng], ...], ...], for drawing only: distance rules are not drawn, and the price and branch for an address come from GET /delivery/quote. Empty when no branch has zones',
  })
  deliveryZones: LatLng[][];
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
    type: String,
    nullable: true,
    example: 'order.restaurant.uz',
    description:
      "The venue's earliest verified own domain (bare host, no scheme), or null; the platform address {slug}.PLATFORM_DOMAIN always works",
  })
  primaryDomain: string | null;

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
    type: FullThemeDto,
    description:
      'Brand colors over the platform neutral colors: always all 9 keys, never null. Front-ends keep no neutral values of their own',
  })
  theme: FullThemeDto;

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
