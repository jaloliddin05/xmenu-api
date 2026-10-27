import { Injectable } from '@nestjs/common';
import { buildClickUrl, buildPaymeUrl, resolveReturnUrl } from '../domain/payment-url';
import { PaymentConfigService } from './payment-config.service';

@Injectable()
export class PaymentLinkService {
  constructor(private readonly configs: PaymentConfigService) {}

  /** Naqd yoki provayder o'chirilgan bo'lsa null. */
  async buildUrl(order: { id: string; total: number; payment_method: string; organization_id: string }, lang: 'ru' | 'uz' | 'en' = 'ru'): Promise<string | null> {
    const returnUrl = resolveReturnUrl(order.id);
    if (order.payment_method === 'click') {
      const cfg = await this.configs.getClick(order.organization_id);
      return cfg ? buildClickUrl(cfg, order, returnUrl) : null;
    }
    if (order.payment_method === 'payme') {
      const cfg = await this.configs.getPayme(order.organization_id);
      return cfg ? buildPaymeUrl(cfg, order, returnUrl, lang) : null;
    }
    return null;
  }
}
