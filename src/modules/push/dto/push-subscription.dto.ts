import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Keys of PushSubscription.toJSON(): the browser's P-256 key (65 bytes) and auth secret (16 bytes), base64url. */
export class PushSubscriptionKeysDto {
  @ApiProperty({
    example:
      'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  })
  @IsString()
  @Matches(BASE64URL)
  @MaxLength(100)
  readonly p256dh: string;

  @ApiProperty({ example: 'tBHItJI5svbpez7KI4CCXg' })
  @IsString()
  @Matches(BASE64URL)
  @MaxLength(50)
  readonly auth: string;
}

export class PushSubscribeDto {
  @ApiProperty({
    description: 'PushSubscription.endpoint (https URL of the push service)',
    example: 'https://fcm.googleapis.com/fcm/send/dpH5lCsTSSM:APA91bH...',
  })
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  @MaxLength(1000)
  readonly endpoint: string;

  @ApiProperty({ type: PushSubscriptionKeysDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  readonly keys: PushSubscriptionKeysDto;

  @ApiPropertyOptional({
    description:
      'navigator.userAgent, to tell the devices apart (up to 300 characters are kept)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  readonly userAgent?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      "Branches of the venue whose orders this device gets; empty or absent = all branches. The list replaces the device's previous choice (a repeated POST with the same endpoint without the field resets it to all). A branch of another venue: 404 not_found",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  readonly branchIds?: string[];
}

export class PushUnsubscribeDto {
  @ApiProperty({
    example: 'https://fcm.googleapis.com/fcm/send/dpH5lCsTSSM:APA91bH...',
  })
  @IsString()
  @MaxLength(1000)
  readonly endpoint: string;
}

export class PushPublicKeyDto {
  @ApiProperty({
    description:
      'VAPID public key (base64url) for pushManager.subscribe({ applicationServerKey })',
    example:
      'BHP4ACfXvV8uE98UzA2N97fUQokHUFjIH9YMs-wGIJjhDLfhzTOLV8e4LZsClOcegRgYICe55ZmwcHYN-fHhc4Y',
  })
  readonly publicKey: string;
}
