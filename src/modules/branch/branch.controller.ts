import { Controller, Get, Header, Req } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { resolveLang } from 'src/infra/http/request-helpers';
import { CustomerPublicRoute } from '../auth/decorators/customer-route.decorator';
import { CurrentTenant } from '../tenant/current-tenant.decorator';
import type { Tenant } from '../tenant/tenant.service';
import { BranchService, BranchView } from './services/branch.service';

/** Mijoz ilovasi uchun filiallar. Ommaviy: token talab qilinmaydi, tenant — X-Tenant-Id. */
@ApiTags('Branches (customer)')
@ApiHeader({ name: 'X-Tenant-Id', description: 'Organization id (UUID); resolve a slug with GET /tenant/by-slug/:slug', required: true })
@CustomerPublicRoute()
@Controller('branches')
export class BranchController {
  constructor(private readonly branches: BranchService) {}

  @Get()
  @ApiOperation({ summary: 'Faol filiallar (hours/isOpen/opensAt serverda hisoblanadi)' })
  // isOpen vaqtga bog'liq — qisqa kesh. Vary: javob tenant va tilga qarab farq qiladi.
  @Header('Cache-Control', 'public, max-age=30')
  @Header('Vary', 'X-Tenant-Id, Accept-Language')
  list(@CurrentTenant() tenant: Tenant, @Req() req: Request): Promise<BranchView[]> {
    return this.branches.listPublic(tenant.id, resolveLang(req));
  }
}
