import { Controller, Get, Header, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { TenantHostRefDto, TenantRefDto } from './dto/tenant-ref.dto';
import { TenantService } from './tenant.service';
import { AppException } from 'src/infra/errors/app-exception';

/** Public tenant lookups for the QR menu and the delivery front-end. */
@ApiTags('Tenant')
@Controller('tenant')
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  /**
   * Front-ends map the public, renameable slug (URL) to the stable tenant id once, then send that
   * id in X-Tenant-Id. Short cache: the answer changes when the owner renames the slug.
   */
  @Public()
  @Get('by-slug/:slug')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary: 'Resolve a public slug to the tenant id (send it in X-Tenant-Id)',
  })
  @ApiOkResponse({ type: TenantRefDto })
  @ApiNotFoundResponse({
    description:
      'tenant_not_found: no such slug, invalid slug or inactive venue',
  })
  async bySlug(@Param('slug') slug: string): Promise<TenantRefDto> {
    const tenant = await this.tenants.findActiveBySlug(slug);
    if (!tenant) throw new AppException('tenant_not_found');
    return tenant;
  }

  /**
   * The delivery site sends the host it was requested on (its own Host header, port allowed). The
   * backend never takes a tenant from a request's own Host or X-Forwarded-Host: only this table-or-
   * platform lookup turns a host into a venue. Short cache, as by-slug: domains and slugs change.
   */
  @Public()
  @Get('by-host/:host')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary:
      'Resolve the host of the delivery site to the tenant id: {slug}.PLATFORM_DOMAIN or a verified venue domain',
  })
  @ApiOkResponse({ type: TenantHostRefDto })
  @ApiNotFoundResponse({
    description:
      'tenant_not_found: unknown or unverified host, another platform host, inactive venue, not a host name',
  })
  async byHost(@Param('host') host: string): Promise<TenantHostRefDto> {
    const tenant = await this.tenants.findActiveByHost(host);
    if (!tenant) throw new AppException('tenant_not_found');
    return tenant;
  }
}
