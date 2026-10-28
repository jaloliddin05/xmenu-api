import { Controller, Get, Header, Param, UseFilters } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { CustomerAuthException } from '../auth/errors/customer-auth.exception';
import { CustomerExceptionFilter } from '../auth/errors/customer-exception.filter';
import { TenantRefDto } from './dto/tenant-ref.dto';
import { TenantService } from './tenant.service';

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
  @UseFilters(CustomerExceptionFilter)
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
    if (!tenant) throw new CustomerAuthException('tenant_not_found');
    return tenant;
  }
}
