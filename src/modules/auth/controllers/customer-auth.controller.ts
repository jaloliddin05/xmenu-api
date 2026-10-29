import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Request } from 'express';

import {
  CustomerLogoutDto,
  CustomerOtpRequestDto,
  CustomerOtpVerifyDto,
  CustomerRefreshDto,
  CustomerRegisterDto,
  CustomerTelegramDto,
  CustomerTelegramStartDto,
  CustomerTelegramStatusDto,
} from '../dto';
import { CustomerOtpRequestResponseDto } from '../dto/customer-otp-response.dto';
import {
  CustomerPhoneRequiredDto,
  CustomerRegistrationRequiredDto,
  CustomerSessionDto,
  CustomerSignedInDto,
  CustomerTokenPairDto,
  CustomerUserDto,
} from '../dto/auth-response.dto';
import {
  CustomerTelegramStartResponseDto,
  CustomerTelegramStatusResponseDto,
} from '../dto/customer-telegram-verify.dto';
import { CustomerAuthService } from '../services/customer-auth.service';
import { TelegramVerificationService } from '../services/telegram-verification.service';
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
@ApiExtraModels(CustomerSignedInDto, CustomerRegistrationRequiredDto, CustomerPhoneRequiredDto)
@ApiHeader({
  name: 'X-Tenant-Id',
  description: 'Organization id (UUID); resolve a slug with GET /tenant/by-slug/:slug',
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
  constructor(
    private readonly auth: CustomerAuthService,
    private readonly telegramVerification: TelegramVerificationService,
  ) {}

  @CustomerPublicRoute()
  @Post('otp/request')
  @HttpCode(200)
  @ApiOkResponse({ type: CustomerOtpRequestResponseDto })
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
  @ApiOperation({ summary: 'Check the code: known phone signs in (isNewUser false), new phone gets a registrationToken' })
  @ApiOkResponse({ schema: { oneOf: [{ $ref: getSchemaPath(CustomerSignedInDto) }, { $ref: getSchemaPath(CustomerRegistrationRequiredDto) }] } })
  verifyOtp(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: CustomerOtpVerifyDto,
    @Req() req: Request,
  ) {
    return this.auth.verifyOtp(tenant, dto, ctxOf(req));
  }

  /**
   * Telegram phone verification (alternative to SMS). Mini App: pass initData, share contact, poll
   * status. Website: pass phone, open deepLink, share contact, type the code sent into the chat,
   * then call otp/verify. See docs/TELEGRAM_VERIFICATION.md.
   */
  @CustomerPublicRoute()
  @Post('telegram/start')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Start phone verification through the venue Telegram bot (503 telegram_unavailable: no bot, offer SMS only)',
  })
  @ApiOkResponse({ type: CustomerTelegramStartResponseDto })
  telegramStart(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: CustomerTelegramStartDto,
    @Req() req: Request,
  ) {
    return this.telegramVerification.start(tenant, dto, ctxOf(req));
  }

  @CustomerPublicRoute()
  @Post('telegram/status')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Poll the Telegram verification session every 2 s (the login result is returned once)',
  })
  @ApiOkResponse({ type: CustomerTelegramStatusResponseDto })
  telegramStatus(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: CustomerTelegramStatusDto,
    @Req() req: Request,
  ) {
    return this.telegramVerification.status(tenant, dto.sessionId, ctxOf(req));
  }

  @CustomerPublicRoute()
  @Post('register')
  @HttpCode(200)
  @ApiOkResponse({ type: CustomerSessionDto })
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
  @ApiOkResponse({ type: CustomerTokenPairDto })
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
  @ApiNoContentResponse({ description: 'Always 204 (idempotent); the login and its access tokens are revoked' })
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
  @ApiOkResponse({ type: CustomerUserDto })
  me(@CurrentCustomer() me: CustomerPrincipal) {
    return this.auth.me(me.tenantId, me.customerId);
  }

  /** Telegram strategiyasi: initData orqali kirish (oldin ulangan mijoz uchun). */
  @CustomerPublicRoute()
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ schema: { oneOf: [{ $ref: getSchemaPath(CustomerSignedInDto) }, { $ref: getSchemaPath(CustomerRegistrationRequiredDto) }, { $ref: getSchemaPath(CustomerPhoneRequiredDto) }] } })
  telegramLogin(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: CustomerTelegramDto,
    @Req() req: Request,
  ) {
    return this.auth.telegramLogin(tenant, dto.initData, ctxOf(req));
  }
}
