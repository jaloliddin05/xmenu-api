import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { AppException } from 'src/infra/errors/app-exception';

export type CourierMode = 'own' | 'external' | 'both';

/**
 * Venue-wide ordering settings. Delivery prices and minimums are per branch (branch delivery pricing);
 * the venue sets the rounding step of the delivery fee and who delivers.
 */
export interface OrderSettings {
  minOrderPickup: number;
  /** Delivery fees are rounded up to it: 100, 500 or 1000 */
  deliveryPriceStep: number;
  /** external: only external services deliver, so cash on delivery is not offered */
  courierMode: CourierMode;
  acceptanceTimeoutSeconds: number;
  paymentTimeoutSeconds: number;
  maxActiveOrders: number;
}

/** Cash on delivery needs own couriers: an external service does not collect cash for the venue. */
export const cashOnDelivery = (mode: CourierMode): boolean =>
  mode !== 'external';

const TTL_MS = 30_000;

@Injectable()
export class OrderSettingsService {
  private readonly logger = new Logger(OrderSettingsService.name);
  private cache = new Map<string, { at: number; value: OrderSettings }>();

  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string): Promise<OrderSettings> {
    const hit = this.cache.get(organizationId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

    const row = await this.prisma.organization_order_settings.findUnique({
      where: { organization_id: organizationId },
    });
    // The row is created at signup; a missing one is a data bug, never filled in with made-up values
    if (!row) {
      this.logger.error(
        `organization_order_settings row missing for organization ${organizationId}`,
      );
      throw new AppException('settings_missing', {
        message: 'Venue settings are missing',
      });
    }
    const value: OrderSettings = {
      minOrderPickup: row.min_order_pickup,
      deliveryPriceStep: row.delivery_price_step,
      courierMode: row.courier_mode,
      acceptanceTimeoutSeconds: row.acceptance_timeout_seconds,
      paymentTimeoutSeconds: row.payment_timeout_seconds,
      maxActiveOrders: row.max_active_orders,
    };

    if (this.cache.size > 1000) this.cache.clear();
    this.cache.set(organizationId, { at: Date.now(), value });
    return value;
  }

  invalidate(organizationId: string) {
    this.cache.delete(organizationId);
  }
}
