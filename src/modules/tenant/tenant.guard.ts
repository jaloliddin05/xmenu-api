import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { CustomerAuthException } from '../auth/errors/customer-auth.exception';
import { TenantService } from './tenant.service';

export const TENANT_HEADER = 'x-tenant-id';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly tenants: TenantService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { tenant?: unknown }>();
    const raw = req.headers[TENANT_HEADER];
    const id = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!id) throw new CustomerAuthException('tenant_required');

    req.tenant = await this.tenants.resolve(id);
    return true;
  }
}
