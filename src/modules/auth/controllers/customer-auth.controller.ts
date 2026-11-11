import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
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
import {
  INIT_DATA_HEADER,
  MiniAppAccessService,
} from '../services/mini-app-access.service';
import { requestCtx as ctxOf } from 'src/infra/http/request-helpers';
import {
  CurrentCustomer,
  CustomerProtectedRoute,
  CustomerPublicRoute,
} from '../decorators/customer-route.decorator';
import type { CustomerPrincipal } from '../decorators/customer-route.decorator';
import { CurrentTenant } from '../../tenant/current-tenant.decorator';
import type { Tenant } from '../../tenant/tenant.service';
import { TenantAuthChannelsDto } from '../../tenant/dto/tenant-config.dto';
import { GuestLoginService } from '../../guest-login/guest-login.service';

/** Sign-in steps that the venue's delivery mode applies to (docs/TELEGRAM_VERIFICATION.md). */
const ApiInitDataHeader = () =>
  ApiHeader({
    name: 'X-Telegram-Init-Data',
    description:
      'Raw Telegram.WebApp.initData inside the venue Mini App. Mode miniapp: required (403 miniapp_required); ' +
      'miniapp and both: checked against the venue bot and TELEGRAM_INITDATA_MAX_AGE_SECONDS (403 miniapp_init_data_invalid); ' +
      'site: ignored',
    required: false,
  });

@ApiTags('Auth-Customer')
@ApiExtraModels(
  CustomerSignedInDto,
  CustomerRegistrationRequiredDto,
  CustomerPhoneRequiredDto,
)
@ApiHeader({
  name: 'X-Tenant-Id',
  description:
    'Organization id (UUID); resolve a slug with GET /tenant/by-slug/:slug',
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
    private readonly guestLogin: GuestLoginService,
    private readonly miniApp: MiniAppAccessService,
  ) {}

  /**
   * Sign-in methods right now, for the sign-in sheet. Unlike channels.auth of GET /tenant/config it is
   * never cached (Cache-Control: no-store on every /auth/customer route).
   */
  @CustomerPublicRoute()
  @Get('methods')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Ways a customer can confirm a phone now: sms (platform) and telegram (venue bot). Not cached',
  })
  @ApiOkResponse({ type: TenantAuthChannelsDto })
  methods(@CurrentTenant() tenant: Tenant): Promise<TenantAuthChannelsDto> {
    return this.guestLogin.methods(tenant.id);
  }

  @CustomerPublicRoute()
  @Post('otp/request')
  @HttpCode(200)
  @ApiInitDataHeader()
  @ApiOkResponse({ type: CustomerOtpRequestResponseDto })
  async requestOtp(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: CustomerOtpRequestDto,
    @Headers(INIT_DATA_HEADER) initData: string | undefined,
    @Req() req: Request,
  ) {
    await this.miniApp.assert(tenant.id, initData);
    return this.auth.requestOtp(tenant, dto.phone, ctxOf(req));
  }

  @CustomerPublicRoute()
  @Post('otp/verify')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Check the code: known phone signs in (isNewUser false), new phone gets a registrationToken',
  })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(CustomerSignedInDto) },
        { $ref: getSchemaPath(CustomerRegistrationRequiredDto) },
      ],
    },
  })
  @ApiInitDataHeader()
  async verifyOtp(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: CustomerOtpVerifyDto,
    @Headers(INIT_DATA_HEADER) initData: string | undefined,
    @Req() req: Request,
  ) {
    const tg = await this.miniApp.assert(tenant.id, initData);
    // A checked header links the Telegram user like initData in the body does
    return this.auth.verifyOtp(
      tenant,
      tg && !dto.initData ? { ...dto, initData } : dto,
      ctxOf(req),
    );
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
  @ApiInitDataHeader()
  async telegramStart(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: CustomerTelegramStartDto,
    @Headers(INIT_DATA_HEADER) initData: string | undefined,
    @Req() req: Request,
  ) {
    const tg = await this.miniApp.assert(tenant.id, initData ?? dto.initData);
    // Inside the Mini App the header alone starts the instant mode
    return this.telegramVerification.start(
      tenant,
      tg && !dto.initData ? { ...dto, initData } : dto,
      ctxOf(req),
    );
  }

  @CustomerPublicRoute()
  @Post('telegram/status')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Poll the Telegram verification session every 2 s (the login result is returned once)',
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
  @ApiInitDataHeader()
  async register(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: CustomerRegisterDto,
    @Headers(INIT_DATA_HEADER) initData: string | undefined,
    @Req() req: Request,
  ) {
    const tg = await this.miniApp.assert(tenant.id, initData);
    return this.auth.register(
      tenant,
      tg && !dto.initData ? { ...dto, initData } : dto,
      ctxOf(req),
    );
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
  @ApiNoContentResponse({
    description:
      'Always 204 (idempotent); the login and its access tokens are revoked',
  })
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
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(CustomerSignedInDto) },
        { $ref: getSchemaPath(CustomerRegistrationRequiredDto) },
        { $ref: getSchemaPath(CustomerPhoneRequiredDto) },
      ],
    },
  })
  @ApiInitDataHeader()
  async telegramLogin(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: CustomerTelegramDto,
    @Headers(INIT_DATA_HEADER) initData: string | undefined,
    @Req() req: Request,
  ) {
    // The body initData is the Mini App data too: the mode check sees it when the header is missing
    await this.miniApp.assert(tenant.id, initData ?? dto.initData);
    return this.auth.telegramLogin(tenant, dto.initData, ctxOf(req));
  }
}
