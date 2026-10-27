import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { parseZone } from '../domain/order-money';

export interface OrderSettings {
  deliveryServiceFee: number;
  minOrderDelivery: number;
  minOrderPickup: number;
  etaMin: number;
  etaMax: number;
  acceptanceTimeoutSeconds: number;
  paymentTimeoutSeconds: number;
  maxActiveOrders: number;
  deliveryZone: [number, number][] | null;
}

/** organization_order_settings qatori yo'q tenantlar uchun standart qiymatlar. */
export const DEFAULT_ORDER_SETTINGS: OrderSettings = {
  deliveryServiceFee: 0,
  minOrderDelivery: 0,
  minOrderPickup: 0,
  etaMin: 20,
  etaMax: 30,
  acceptanceTimeoutSeconds: 300,
  paymentTimeoutSeconds: 900,
  maxActiveOrders: 5,
  deliveryZone: null,
};

const TTL_MS = 30_000;

@Injectable()
export class OrderSettingsService {
  private cache = new Map<string, { at: number; value: OrderSettings }>();

  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string): Promise<OrderSettings> {
    const hit = this.cache.get(organizationId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

    const row = await this.prisma.organization_order_settings.findUnique({ where: { organization_id: organizationId } });
    const value: OrderSettings = row
      ? {
          deliveryServiceFee: row.delivery_service_fee,
          minOrderDelivery: row.min_order_delivery,
          minOrderPickup: row.min_order_pickup,
          etaMin: row.eta_min,
          etaMax: row.eta_max,
          acceptanceTimeoutSeconds: row.acceptance_timeout_seconds,
          paymentTimeoutSeconds: row.payment_timeout_seconds,
          maxActiveOrders: row.max_active_orders,
          deliveryZone: parseZone(row.delivery_zone),
        }
      : DEFAULT_ORDER_SETTINGS;

    if (this.cache.size > 1000) this.cache.clear();
    this.cache.set(organizationId, { at: Date.now(), value });
    return value;
  }

  invalidate(organizationId: string) {
    this.cache.delete(organizationId);
  }
}
