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
