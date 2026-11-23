import { Controller, Get, Header } from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CustomerPublicRoute } from 'src/modules/auth/decorators/customer-route.decorator';
import { CurrentTenant } from 'src/modules/tenant/current-tenant.decorator';
import type { Tenant } from 'src/modules/tenant/tenant.service';
import { PublicDeliveryAreaDto } from '../dto/delivery-area.dto';
import { DeliveryAreaService } from '../services/delivery-area.service';

/**
 * Guest map: the venue delivery area. Not in GET /tenant/config (the geometry is large and changes rarely):
 * cached for 5 minutes with an ETag (Express answers If-None-Match with 304), so a saved area reaches guests
 * without a revalidation.
 */
@ApiTags('Delivery (customer)')
@ApiHeader({
  name: 'X-Tenant-Id',
  description:
    'Organization id (UUID); resolve a slug with GET /tenant/by-slug/:slug',
  required: true,
})
@CustomerPublicRoute()
@Controller('delivery')
export class DeliveryAreaPublicController {
  constructor(private readonly area: DeliveryAreaService) {}

  @Get('area')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({
    summary:
      'Venue delivery area for the map: parts as rings (5 decimals, even-odd), or null when the venue has none',
  })
  @ApiOkResponse({
    type: PublicDeliveryAreaDto,
    headers: {
      'Cache-Control': { description: 'public, max-age=300' },
      ETag: {
        description: 'Send it back as If-None-Match: 304 while unchanged',
      },
    },
  })
  get(@CurrentTenant() tenant: Tenant): Promise<PublicDeliveryAreaDto> {
    return this.area.forGuest(tenant.id);
  }
}
