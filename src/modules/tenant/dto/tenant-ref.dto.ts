import { ApiProperty } from '@nestjs/swagger';

export class TenantRefDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Tenant id: send it as X-Tenant-Id',
  })
  id: string;

  @ApiProperty({ example: 'cafe-example' })
  slug: string;
}

export class TenantHostRefDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Tenant id: send it as X-Tenant-Id',
  })
  id: string;

  @ApiProperty({ type: String, nullable: true, example: 'cafe-example' })
  slug: string | null;

  @ApiProperty({ example: 'Demo Cafe' })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'order.restaurant.uz',
    description:
      "The venue's earliest verified own domain (bare host), or null",
  })
  primaryDomain: string | null;
}
