import { Controller, Get, Header } from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CustomerPublicRoute } from 'src/modules/auth/decorators/customer-route.decorator';
import { PaymentConfigService } from 'src/modules/payment/services/payment-config.service';
import { CurrentTenant } from 'src/modules/tenant/current-tenant.decorator';
import type { Tenant } from 'src/modules/tenant/tenant.service';
import { CheckoutConfigDto } from '../dto/checkout-config.dto';
import {
  cashOnDelivery,
  OrderSettingsService,
} from '../services/order-settings.service';

/**
 * Savat hisob-kitobi uchun sozlamalar: olib ketish minimumi va hozir yoqilgan to'lov usullari (yetkazish va
 * olib ketish uchun alohida). The delivery fee and minimum depend on the address: GET /delivery/quote.
 * Maxfiy narsa yo'q: ommaviy.
 */
@ApiTags('Checkout config (customer)')
@ApiHeader({
  name: 'X-Tenant-Id',
  description:
    'Organization id (UUID); resolve a slug with GET /tenant/by-slug/:slug',
  required: true,
})
@CustomerPublicRoute()
@Controller('checkout-config')
export class CheckoutConfigController {
  constructor(
    private readonly settings: OrderSettingsService,
    private readonly payments: PaymentConfigService,
  ) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=30')
  @Header('Vary', 'X-Tenant-Id')
  @ApiOperation({
    summary:
      "Savat sozlamalari: olib ketish minimumi, to'lov usullari (yetkazish va olib ketish)",
  })
  @ApiOkResponse({ type: CheckoutConfigDto })
  async get(@CurrentTenant() tenant: Tenant): Promise<CheckoutConfigDto> {
    const [s, online] = await Promise.all([
      this.settings.get(tenant.id),
      this.payments.enabledProviders(tenant.id),
    ]);
    const providers = (['click', 'payme'] as const).filter((p) =>
      online.has(p),
    );
    return {
      currency: tenant.currency,
      minOrderPickup: s.minOrderPickup,
      paymentMethods: {
        delivery: cashOnDelivery(s.courierMode)
          ? ['cash', ...providers]
          : [...providers],
        pickup: ['cash', ...providers],
      },
    };
  }
}
