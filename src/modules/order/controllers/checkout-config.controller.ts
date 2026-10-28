import { Controller, Get, Header } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomerPublicRoute } from 'src/modules/auth/decorators/customer-route.decorator';
import { PaymentConfigService } from 'src/modules/payment/services/payment-config.service';
import { CurrentTenant } from 'src/modules/tenant/current-tenant.decorator';
import type { Tenant } from 'src/modules/tenant/tenant.service';
import { OrderSettingsService } from '../services/order-settings.service';

/**
 * Savat hisob-kitobi uchun sozlamalar: yetkazib berish narxi, minimal summa,
 * ETA va hozir yoqilgan to'lov usullari. Frontend ularni savatda ko'rsatadi —
 * shu sababli serverdagi haqiqiy qiymatlar bilan mos bo'ladi (aks holda
 * expectedTotal har safar farq qilib, `price_changed` aylanib qolardi).
 * Maxfiy narsa yo'q: ommaviy.
 */
@ApiTags('Checkout config (customer)')
@ApiHeader({ name: 'X-Tenant-Id', description: 'Organization id (UUID); resolve a slug with GET /tenant/by-slug/:slug', required: true })
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
  @ApiOperation({ summary: "Savat sozlamalari: yetkazib berish narxi, minimal summa, ETA, to'lov usullari" })
  async get(@CurrentTenant() tenant: Tenant) {
    const [s, online] = await Promise.all([this.settings.get(tenant.id), this.payments.enabledProviders(tenant.id)]);
    return {
      currency: 'UZS',
      deliveryServiceFee: s.deliveryServiceFee,
      minOrder: { delivery: s.minOrderDelivery, pickup: s.minOrderPickup },
      etaMinutes: [s.etaMin, s.etaMax],
      paymentMethods: ['cash', ...(['click', 'payme'] as const).filter((p) => online.has(p))],
    };
  }
}
