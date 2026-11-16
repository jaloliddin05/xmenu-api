import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  decryptConfig,
  encryptConfig,
  parsePaymentConfigKey,
} from '../domain/payment-crypto';
import { ClickConfig, PaymeConfig } from '../domain/payment-url';
import { fieldError } from 'src/infra/validators/validation-errors';
import {
  AppException,
  platformMisconfigured,
} from 'src/infra/errors/app-exception';
import { errorMessage } from 'src/infra/helper/error-text';
import { providerDisableLeavesNoMethod } from 'src/modules/order/domain/delivery-payment';
import { lockDeliveryPayment } from 'src/modules/order/services/delivery-payment-state';

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
    if (this.cachedKey) return this.cachedKey;
    try {
      return (this.cachedKey = parsePaymentConfigKey(
        process.env.PAYMENT_CONFIG_KEY,
      ));
    } catch (e) {
      throw platformMisconfigured('payments', errorMessage(e));
    }
  }

  async getClick(organizationId: string): Promise<ClickConfig | null> {
    return this.get<ClickConfig>(organizationId, 'click');
  }

  async getPayme(organizationId: string): Promise<PaymeConfig | null> {
    return this.get<PaymeConfig>(organizationId, 'payme');
  }

  private async get<T>(
    organizationId: string,
    provider: OnlineProvider,
  ): Promise<T | null> {
    const row = await this.prisma.organization_payment_provider.findUnique({
      where: {
        organization_id_provider: { organization_id: organizationId, provider },
      },
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
    const rows = await this.prisma.organization_payment_provider.findMany({
      where: { organization_id: organizationId },
    });
    return rows.map((r) => ({
      provider: r.provider,
      isEnabled: r.is_enabled,
      configured: true,
      updatedAt: r.updated_at,
    }));
  }

  async upsert(
    organizationId: string,
    provider: OnlineProvider,
    config: Record<string, unknown>,
    isEnabled: boolean,
  ) {
    const clean: Record<string, string> = {};
    for (const field of FIELDS[provider]) {
      const v = config?.[field];
      if (typeof v !== 'string' || !v.trim())
        throw fieldError(
          `config.${field}`,
          'required',
          `config.${field} is required for ${provider}`,
        );
      clean[field] = v.trim();
    }
    const config_encrypted = encryptConfig(clean, this.key);
    await this.prisma.$transaction(async (tx) => {
      if (!isEnabled)
        await this.assertNotLastMethod(tx, organizationId, provider);
      await tx.organization_payment_provider.upsert({
        where: {
          organization_id_provider: {
            organization_id: organizationId,
            provider,
          },
        },
        create: {
          organization_id: organizationId,
          provider,
          is_enabled: isEnabled,
          config_encrypted,
        },
        update: { is_enabled: isEnabled, config_encrypted },
      });
    });
    return { provider, isEnabled, configured: true };
  }

  async setEnabled(
    organizationId: string,
    provider: OnlineProvider,
    isEnabled: boolean,
  ) {
    await this.prisma.$transaction(async (tx) => {
      if (!isEnabled)
        await this.assertNotLastMethod(tx, organizationId, provider);
      await tx.organization_payment_provider.updateMany({
        where: { organization_id: organizationId, provider },
        data: { is_enabled: isEnabled },
      });
    });
  }

  /** Switching a provider off must not take away the guest's last payment method at delivery (W13F-04) */
  private async assertNotLastMethod(
    tx: Prisma.TransactionClient,
    organizationId: string,
    provider: OnlineProvider,
  ) {
    const state = await lockDeliveryPayment(tx, organizationId);
    if (providerDisableLeavesNoMethod(state, state.providers, provider))
      throw new AppException('delivery_payment_last_method');
  }
}
