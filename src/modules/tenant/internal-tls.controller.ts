import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { isInternalRequest } from 'src/infra/http/internal-request';
import { Public } from '../auth/decorators/public.decorator';
import { TenantService } from './tenant.service';

/**
 * The `ask` endpoint of Caddy's on-demand TLS: Caddy issues a certificate for a host only after this
 * answers 200. Allowed: {slug}.PLATFORM_DOMAIN of an active venue and a verified own domain of an active
 * venue (the same rule as GET /tenant/by-host), nothing else. Only inside the private network: a request
 * through the public proxy gets the same empty 404 as an unknown host. No body either way.
 */
@ApiExcludeController()
@Controller('internal/tls')
export class InternalTlsController {
  constructor(private readonly tenants: TenantService) {}

  @Public()
  @Get('allow')
  async allow(
    @Query('domain') domain: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const allowed =
      isInternalRequest(req) &&
      typeof domain === 'string' &&
      (await this.tenants.findActiveByHost(domain)) !== null;
    res.setHeader('Cache-Control', 'no-store');
    res.status(allowed ? 200 : 404).end();
  }
}
