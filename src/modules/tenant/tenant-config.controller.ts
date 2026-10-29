import { Controller, Get, Header, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { resolveLang } from 'src/infra/http/request-helpers';
import { CustomerPublicRoute } from '../auth/decorators/customer-route.decorator';
import { CurrentTenant } from './current-tenant.decorator';
import { TenantConfigDto } from './dto/tenant-config.dto';
import { TenantConfigService } from './tenant-config.service';
import type { Tenant } from './tenant.service';

/** Public configuration of one venue for the QR menu and the delivery front-end. */
@ApiTags('Tenant')
@CustomerPublicRoute()
@Controller('tenant')
export class TenantConfigController {
  constructor(private readonly config: TenantConfigService) {}

  @Get('config')
  @ApiHeader({
    name: 'X-Tenant-Id',
    description:
      'Organization id (UUID); resolve a slug with GET /tenant/by-slug/:slug',
    required: true,
  })
  @ApiHeader({
    name: 'Accept-Language',
    description:
      "ru, uz or en (or ?lang=); a language the venue does not offer gives the venue's default",
    required: false,
  })
  @Header('Cache-Control', 'public, max-age=60')
  @Header('Vary', 'X-Tenant-Id, Accept-Language')
  @ApiOperation({
    summary:
      'Venue configuration: brand, colors, languages, currency, contacts, fulfillment modes, map',
  })
  @ApiOkResponse({ type: TenantConfigDto })
  @ApiBadRequestResponse({ description: 'tenant_required: no X-Tenant-Id' })
  @ApiNotFoundResponse({
    description: 'tenant_not_found: X-Tenant-Id is not a venue id',
  })
  @ApiForbiddenResponse({ description: 'tenant_inactive' })
  get(
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ): Promise<TenantConfigDto> {
    return this.config.get(tenant, resolveLang(req, tenant));
  }
}
