import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Tenant } from './tenant.service';

export const CurrentTenant = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): Tenant => ctx.switchToHttp().getRequest().tenant,
);
