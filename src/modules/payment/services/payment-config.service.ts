import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { decryptConfig, encryptConfig, parsePaymentConfigKey } from '../domain/payment-crypto';
import { ClickConfig, PaymeConfig } from '../domain/payment-url';

export type OnlineProvider = 'click' | 'payme';

const FIELDS: Record<OnlineProvider, string[]> = {
  click: ['merchantId', 'serviceId', 'merchantUserId', 'secretKey'],
  payme: ['merchantId', 'key'],
};

/** Tenant to'lov kalitlari: shifrlangan holda saqlanadi, javoblarda HECH QACHON qaytarilmaydi. */
@Injectable()
export class PaymentConfigService {
  private cachedKey?: Buffer;

  constructor(private readonly prisma: PrismaService) {}

  private get key(): Buffer {
    // Kalit faqat kerak bo'lganda tekshiriladi: to'lov ishlatilmaydigan o'rnatishlar PAYMENT_CONFIG_KEY'siz ham yuklanadi.
    return (this.cachedKey ??= parsePaymentConfigKey(process.env.PAYMENT_CONFIG_KEY));
  }

  async getClick(organizationId: string): Promise<ClickConfig | null> {
    return this.get<ClickConfig>(organizationId, 'click');
  }

  async getPayme(organizationId: string): Promise<PaymeConfig | null> {
    return this.get<PaymeConfig>(organizationId, 'payme');
  }

  private async get<T>(organizationId: string, provider: OnlineProvider): Promise<T | null> {
    const row = await this.prisma.organization_payment_provider.findUnique({
      where: { organization_id_provider: { organization_id: organizationId, provider } },
    });
    if (!row || !row.is_enabled) return null;
    return decryptConfig<T>(row.config_encrypted, this.key);
  }

  /** Buyurtma yaratishda: qaysi onlayn usullar yoqilgan (shifrni ochmasdan). */
  async enabledProviders(organizationId: string): Promise<Set<OnlineProvider>> {
    const rows = await this.prisma.organization_payment_provider.findMany({
      where: { organization_id: organizationId, is_enabled: true },
      select: { provider: true },
    });
    return new Set(rows.map((r) => r.provider));
  }

  async list(organizationId: string) {
    const rows = await this.prisma.organization_payment_provider.findMany({ where: { organization_id: organizationId } });
    return rows.map((r) => ({ provider: r.provider, isEnabled: r.is_enabled, configured: true, updatedAt: r.updated_at }));
  }

  async upsert(organizationId: string, provider: OnlineProvider, config: Record<string, unknown>, isEnabled: boolean) {
    const clean: Record<string, string> = {};
    for (const field of FIELDS[provider]) {
      const v = config?.[field];
      if (typeof v !== 'string' || !v.trim()) throw new BadRequestException(`config.${field} is required for ${provider}`);
      clean[field] = v.trim();
    }
    const config_encrypted = encryptConfig(clean, this.key);
    await this.prisma.organization_payment_provider.upsert({
      where: { organization_id_provider: { organization_id: organizationId, provider } },
      create: { organization_id: organizationId, provider, is_enabled: isEnabled, config_encrypted },
      update: { is_enabled: isEnabled, config_encrypted },
    });
    return { provider, isEnabled, configured: true };
  }

  async setEnabled(organizationId: string, provider: OnlineProvider, isEnabled: boolean) {
    await this.prisma.organization_payment_provider.updateMany({
      where: { organization_id: organizationId, provider },
      data: { is_enabled: isEnabled },
    });
  }
}
