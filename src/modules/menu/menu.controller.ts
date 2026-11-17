import {
  Controller,
  Get,
  Header,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { resolveLang } from 'src/infra/http/request-helpers';
import { CustomerPublicRoute } from '../auth/decorators/customer-route.decorator';
import { CurrentTenant } from '../tenant/current-tenant.decorator';
import type { Tenant } from '../tenant/tenant.service';
import { MenuCategoryDto } from './dto/menu-view.dto';
import { MenuService } from './menu.service';

/** Mijoz ilovasi menyusi: ommaviy, tenant — X-Tenant-Id, til — ?lang yoki Accept-Language. */
@ApiTags('Menu (customer)')
@ApiHeader({
  name: 'X-Tenant-Id',
  description:
    'Organization id (UUID); resolve a slug with GET /tenant/by-slug/:slug',
  required: true,
})
@CustomerPublicRoute()
@Controller('menu')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get()
  @ApiOperation({
    summary: 'Menyu: kategoriyalar → taomlar → modifikator guruhlari',
  })
  @ApiOkResponse({ type: [MenuCategoryDto] })
  @ApiQuery({
    name: 'branchId',
    required: false,
    description:
      'With a POS connected: leave out what is in the stop list of this branch (without it, only dishes stopped in every linked branch are left out)',
  })
  @Header('Cache-Control', 'public, max-age=30')
  @Header('Vary', 'X-Tenant-Id, Accept-Language')
  get(
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
    @Query('branchId', new ParseUUIDPipe({ optional: true }))
    branchId?: string,
  ) {
    return this.menu.getMenu(
      tenant.id,
      {
        lang: resolveLang(req, tenant),
        fallback: tenant.defaultLanguage,
        currency: tenant.currency,
      },
      branchId,
    );
  }
}
