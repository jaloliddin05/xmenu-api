import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  CustomerLogoutDto,
  CustomerOtpRequestDto,
  CustomerOtpVerifyDto,
  CustomerRefreshDto,
  CustomerRegisterDto,
  CustomerTelegramDto,
} from '../dto';
import { CustomerAuthService } from '../services/customer-auth.service';
import { requestCtx as ctxOf } from 'src/infra/http/request-helpers';
import {
  CurrentCustomer,
  CustomerProtectedRoute,
  CustomerPublicRoute,
} from '../decorators/customer-route.decorator';
import type { CustomerPrincipal } from '../decorators/customer-route.decorator';
import { CurrentTenant } from '../../tenant/current-tenant.decorator';
import type { Tenant } from '../../tenant/tenant.service';

@ApiTags('Auth-Customer')
@ApiHeader({
  name: 'X-Tenant-Id',
  description: 'Organization slug',
  required: true,
})
// '/auth/*' endi band: AuthController (xodimlar) shu yerda /auth/login,
// /auth/register, /auth/refresh ni ushlab turibdi. Bitta Express ilovasida
// ikkita controller bir xil method+path bilan ro'yxatdan o'tsa, ikkinchisi
// jim o'chib qoladi — shuning uchun mijoz oqimi /auth/customer ostiga
// ko'chirilgan, /auth-customer emas (frontend shartnomasi bilan mos: faqat
// bitta segment qo'shiladi, "/auth/otp/request" -> "/auth/customer/otp/request").
@Controller('auth/customer')
export class AuthCustomerController {
  constructor(private readonly auth: CustomerAuthService) {}

  @CustomerPublicRoute()
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: CustomerOtpRequestDto,
    @Req() req: Request,
  ) {
    return this.auth.requestOtp(tenant, dto.phone, ctxOf(req));
  }

  @CustomerPublicRoute()
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: CustomerOtpVerifyDto,
    @Req() req: Request,
  ) {
    return this.auth.verifyOtp(tenant, dto, ctxOf(req));
  }

  @CustomerPublicRoute()
  @Post('register')
  @HttpCode(200)
  register(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: CustomerRegisterDto,
    @Req() req: Request,
  ) {
    return this.auth.register(tenant, dto, ctxOf(req));
  }

  @CustomerPublicRoute()
  @Post('refresh')
  @HttpCode(200)
  refresh(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: CustomerRefreshDto,
    @Req() req: Request,
  ) {
    return this.auth.refresh(tenant, dto.refreshToken, ctxOf(req));
  }

  @CustomerPublicRoute()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: CustomerLogoutDto,
    @Req() req: Request,
  ) {
    await this.auth.logout(tenant, dto?.refreshToken, ctxOf(req));
  }

  @CustomerProtectedRoute()
  @ApiBearerAuth('access-token')
  @Get('me')
  me(@CurrentCustomer() me: CustomerPrincipal) {
    return this.auth.me(me.tenantId, me.customerId);
  }

  /** Telegram strategiyasi: initData orqali kirish (oldin ulangan mijoz uchun). */
  @CustomerPublicRoute()
  @Post('login')
  @HttpCode(200)
  telegramLogin(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: CustomerTelegramDto,
    @Req() req: Request,
  ) {
    return this.auth.telegramLogin(tenant, dto.initData, ctxOf(req));
  }
}
