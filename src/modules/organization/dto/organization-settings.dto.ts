import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { LANGS } from 'src/infra/http/request-helpers';
import type { Lang } from 'src/infra/http/request-helpers';
import {
  FOUNDED_YEAR_MIN,
  HEX_COLOR_RE,
  MAP_ZOOM_MAX,
  SUPPORTED_CURRENCIES,
} from '../domain/organization-settings';
import type {
  Bounds,
  OrganizationSettings,
  Theme,
} from '../domain/organization-settings';

const PHONE_RE = /^\+998\d{9}$/;
// Telegram username: 5-32 chars, starts with a letter; a leading @ is accepted and dropped
const TELEGRAM_RE = /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/;

/** The field must be present; null clears it. */
const Nullable = () => ValidateIf((_o, value) => value !== null);

const Color = (example: string) =>
  applyDecorators(
    ApiPropertyOptional({ example, pattern: HEX_COLOR_RE.source }),
    IsOptional(),
    IsString(),
    Matches(HEX_COLOR_RE, {
      message: '$property must be a hex color: #RGB, #RRGGBB or #RRGGBBAA',
    }),
  );

export class ThemeDto implements Theme {
  @Color('#F4F4F4') background?: string;
  @Color('#21201F') foreground?: string;
  @Color('#FFFFFF') surface?: string;
  @Color('#EFEFEF') mutedSurface?: string;
  @Color('#4B494380') muted?: string;
  @Color('#EE2E17') brand?: string;
  @Color('#FFFFFF') brandForeground?: string;
  @Color('#E53935') danger?: string;
  @Color('#5B6FE8') serviceArea?: string;
}

export class LatLngDto {
  @ApiProperty({ example: 41.311081, minimum: -90, maximum: 90 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ example: 69.240562, minimum: -180, maximum: 180 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng: number;
}

/**
 * Venue settings for the QR menu and the delivery front-end (GET /tenant/config). PUT replaces the
 * whole document: every field must be sent, null clears a nullable one.
 */
export class OrganizationSettingsDto implements OrganizationSettings {
  @ApiProperty({
    type: ThemeDto,
    nullable: true,
    description:
      'Brand colors; a missing key keeps the front-end neutral value',
  })
  @Nullable()
  @IsObject()
  @ValidateNested()
  @Type(() => ThemeDto)
  theme: ThemeDto | null;

  @ApiProperty({ enum: SUPPORTED_CURRENCIES, example: 'UZS' })
  @IsIn(SUPPORTED_CURRENCIES)
  currency: string;

  @ApiProperty({
    enum: LANGS,
    example: 'ru',
    description: 'Must be one of languages',
  })
  @IsIn(LANGS)
  defaultLanguage: Lang;

  @ApiProperty({ enum: LANGS, isArray: true, example: ['ru', 'uz', 'en'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(LANGS.length)
  @ArrayUnique()
  @IsIn(LANGS, { each: true })
  languages: Lang[];

  @ApiProperty({ nullable: true, example: '+998711234567' })
  @Nullable()
  @Matches(PHONE_RE, { message: 'supportPhone must be +998XXXXXXXXX' })
  supportPhone: string | null;

  @ApiProperty({
    nullable: true,
    example: 'demo_cafe',
    description: 'Telegram username, stored without @',
  })
  @Nullable()
  @Matches(TELEGRAM_RE, {
    message: 'supportTelegram must be a Telegram username (5-32 chars)',
  })
  supportTelegram: string | null;

  @ApiProperty({ nullable: true, example: '10:00-23:00', maxLength: 100 })
  @Nullable()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  supportHours: string | null;

  @ApiProperty({ nullable: true, example: 'Main street 1', maxLength: 255 })
  @Nullable()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  address: string | null;

  @ApiProperty({
    nullable: true,
    example: 2015,
    minimum: FOUNDED_YEAR_MIN,
    description: 'Not in the future',
  })
  @Nullable()
  @IsInt()
  @Min(FOUNDED_YEAR_MIN)
  foundedYear: number | null;

  @ApiProperty({ nullable: true, example: 'Tashkent', maxLength: 100 })
  @Nullable()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city: string | null;

  @ApiProperty({ type: LatLngDto, nullable: true })
  @Nullable()
  @IsObject()
  @ValidateNested()
  @Type(() => LatLngDto)
  mapCenter: LatLngDto | null;

  @ApiProperty({
    nullable: true,
    example: 15,
    minimum: 0,
    maximum: MAP_ZOOM_MAX,
  })
  @Nullable()
  @IsInt()
  @Min(0)
  @Max(MAP_ZOOM_MAX)
  mapZoom: number | null;

  @ApiProperty({
    nullable: true,
    type: 'array',
    items: {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
    },
    minItems: 2,
    maxItems: 2,
    example: [
      [41.15, 69.0],
      [41.45, 69.45],
    ],
    description:
      '[[southWestLat, southWestLng], [northEastLat, northEastLng]]; mapCenter must lie inside',
  })
  @Nullable()
  @IsArray()
  mapBounds: Bounds | null;
}
