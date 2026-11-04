import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { HOST_MAX } from 'src/modules/tenant/host';

export const DOMAIN_STATUSES = ['pending', 'verified'] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export const VERIFY_FAILURES = [
  'record_not_found',
  'token_mismatch',
  'dns_error',
] as const;

export class AddDomainDto {
  @ApiProperty({
    example: 'order.restaurant.uz',
    description:
      'Bare host name: no scheme, path or port. Case, a trailing dot and IDN (ресторан.uz) are normalised. Not the platform domain or anything under it, not localhost, .local, .internal or an IP',
  })
  @IsString()
  // A Unicode name can be longer than its punycode form; the host rule (tenant/host.ts) checks the result
  @MaxLength(HOST_MAX * 2)
  host: string;
}

export class DomainVerificationRecordDto {
  @ApiProperty({ enum: ['TXT'], example: 'TXT' })
  type: 'TXT';

  @ApiProperty({ example: '_xmenu-verify.order.restaurant.uz' })
  name: string;

  @ApiProperty({ example: 'xmenu-verify=Qm9vb...' })
  value: string;
}

export class TenantDomainDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    example: 'xn--80ajzcicfi.uz',
    description: 'Canonical host: ASCII (IDN as punycode), lower case',
  })
  host: string;

  @ApiProperty({
    example: 'ресторан.uz',
    description: 'The host for display',
  })
  hostUnicode: string;

  @ApiProperty({ enum: DOMAIN_STATUSES, example: 'pending' })
  status: DomainStatus;

  @ApiProperty({
    description:
      'This is primaryDomain: the earliest verified domain of the venue',
  })
  isPrimary: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  verifiedAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastCheckAt: Date | null;

  @ApiProperty({
    type: String,
    enum: [...VERIFY_FAILURES, 'domain_taken'],
    nullable: true,
    description: 'Why the last check failed; null after a successful one',
  })
  lastCheckError: string | null;

  @ApiProperty({
    type: DomainVerificationRecordDto,
    description: 'DNS record that proves ownership; keep it after verification',
  })
  verification: DomainVerificationRecordDto;
}

export class TenantDomainListDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'mant.xmenu.uz',
    description:
      'The platform address {slug}.PLATFORM_DOMAIN (always works, needs no row); null without a slug or PLATFORM_DOMAIN',
  })
  platformHost: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'order.restaurant.uz',
    description: 'Earliest verified own domain, or null',
  })
  primaryDomain: string | null;

  @ApiProperty({
    example: 5,
    description: 'Domains a venue may have, pending ones included',
  })
  limit: number;

  @ApiProperty({ type: TenantDomainDto, isArray: true })
  items: TenantDomainDto[];
}
