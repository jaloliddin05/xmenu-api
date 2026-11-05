import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  UseGuards,
} from '@nestjs/common';
import { Public } from './public.decorator';
import { TenantGuard } from '../../tenant/tenant.guard';
import { CustomerAccessTokenGuard } from '../passport-strategies/customer-access-token/customer-access-token.guard';

/**
 * Global AccessTokenUserGuard (xodimlar) ni chetlab o'tadi (@Public),
 * o'rniga tenant aniqlanadi (xatolar umumiy formatda, AppErrorFilter).
 * Token talab qilinmaydi (OTP, register, refresh, logout uchun).
 */
export const CustomerPublicRoute = () =>
  applyDecorators(Public(), UseGuards(TenantGuard));

/** Mijoz access-tokeni (aud=xmenu:customer) talab qilinadi. */
export const CustomerProtectedRoute = () =>
  applyDecorators(Public(), UseGuards(TenantGuard, CustomerAccessTokenGuard));

export interface CustomerPrincipal {
  customerId: string;
  tenantId: string;
  sid: string;
}

export const CurrentCustomer = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): CustomerPrincipal =>
    ctx.switchToHttp().getRequest<{ user: CustomerPrincipal }>().user,
);
