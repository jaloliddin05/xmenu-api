import { applyDecorators, createParamDecorator, ExecutionContext, UseFilters, UseGuards } from '@nestjs/common';
import { Public } from './public.decorator';
import { TenantGuard } from '../../tenant/tenant.guard';
import { CustomerAccessTokenGuard } from '../passport-strategies/customer-access-token/customer-access-token.guard';
import { CustomerExceptionFilter } from '../errors/customer-exception.filter';

/**
 * Global AccessTokenUserGuard (xodimlar) ni chetlab o'tadi (@Public),
 * o'rniga tenant aniqlanadi va mijoz formatidagi xatolar qaytariladi.
 * Token talab qilinmaydi (OTP, register, refresh, logout uchun).
 */
export const CustomerPublicRoute = () =>
  applyDecorators(Public(), UseGuards(TenantGuard), UseFilters(CustomerExceptionFilter));

/** Mijoz access-tokeni (aud=xmenu:customer) talab qilinadi. */
export const CustomerProtectedRoute = () =>
  applyDecorators(
    Public(),
    UseGuards(TenantGuard, CustomerAccessTokenGuard),
    UseFilters(CustomerExceptionFilter),
  );

export interface CustomerPrincipal {
  customerId: string;
  tenantId: string;
  sid: string;
}

export const CurrentCustomer = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): CustomerPrincipal => ctx.switchToHttp().getRequest().user,
);
