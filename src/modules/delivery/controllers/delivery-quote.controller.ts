import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CustomerPublicRoute } from 'src/modules/auth/decorators/customer-route.decorator';
import { CurrentTenant } from 'src/modules/tenant/current-tenant.decorator';
import type { Tenant } from 'src/modules/tenant/tenant.service';
import {
  DeliveryPointQueryDto,
  DeliveryQuoteDto,
} from '../dto/delivery-pricing.dto';
import { DeliveryQuoteService } from '../services/delivery-quote.service';

/**
 * Cart: delivery price, minimum and branch for an address, the same choice POST /orders makes. Public (no
 * customer token): the guest may pick a point on the map before signing in. A GET, so it is not counted by
 * the public POST rate limit.
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
export class DeliveryQuoteController {
  constructor(private readonly quotes: DeliveryQuoteService) {}

  @Get('quote')
  // Depends on the time (open branches) and on the owner's rules: never cached
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Delivery quote for the cart: branch, fee, minimum, how much is missing, or why delivery is unavailable',
  })
  @ApiOkResponse({ type: DeliveryQuoteDto })
  quote(
    @CurrentTenant() tenant: Tenant,
    @Query() q: DeliveryPointQueryDto,
  ): Promise<DeliveryQuoteDto> {
    return this.quotes.quote(tenant.id, [q.lat, q.lng], q.subtotal ?? 0);
  }
}
