import { Controller, Get, Header, Req } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { resolveLang } from 'src/infra/http/request-helpers';
import { CustomerPublicRoute } from '../auth/decorators/customer-route.decorator';
import { CurrentTenant } from '../tenant/current-tenant.decorator';
import type { Tenant } from '../tenant/tenant.service';
import { MenuService } from './menu.service';

/** Mijoz ilovasi menyusi: ommaviy, tenant — X-Tenant-Id, til — ?lang yoki Accept-Language. */
@ApiTags('Menu (customer)')
@ApiHeader({ name: 'X-Tenant-Id', description: 'Organization slug', required: true })
@CustomerPublicRoute()
@Controller('menu')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get()
  @ApiOperation({ summary: 'Menyu: kategoriyalar → taomlar → modifikator guruhlari' })
  @Header('Cache-Control', 'public, max-age=30')
  @Header('Vary', 'X-Tenant-Id, Accept-Language')
  get(@CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.menu.getMenu(tenant.id, resolveLang(req));
  }
}
