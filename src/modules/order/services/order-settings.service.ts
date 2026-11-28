import { LiveEventBus } from 'src/modules/live/live-event-bus';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { AppException } from 'src/infra/errors/app-exception';
import { PayRate, payRateOf } from 'src/modules/courier/domain/courier-pay';
import type { DeliveryPaymentSettings } from '../domain/delivery-payment';

export type CourierMode = 'own' | 'external' | 'both';

/**
 * Venue-wide ordering settings. Delivery prices and minimums are per branch (branch delivery pricing);
 * the venue sets the rounding step of the delivery fee and who delivers.
 */
export interface OrderSettings {
  minOrderPickup: number;
  /** Delivery fees are rounded up to it: 100, 500 or 1000 */
  deliveryPriceStep: number;
  /** external: only external services deliver, so nothing is paid at the door (deliveryPaymentMethods) */
  courierMode: CourierMode;
  /** Payment methods the venue offers at delivery; narrowed by courierMode and the keys */
  deliveryPayment: DeliveryPaymentSettings;
  acceptanceTimeoutSeconds: number;
  paymentTimeoutSeconds: number;
  maxActiveOrders: number;
  /** Remind the courier and the operator when "picked up" is not pressed this long after "ready" */
  pickupReminderMinutes: number;
  /** Alert the operator when an order is on the way longer */
  onTheWayAlertMinutes: number;
  /** Wait at the door after "no answer", then the operator decides */
  doorWaitMinutes: number;
  /** Deliveries pass "preparing" (the venue's kitchen queue); the setting as saved, see order/domain/kitchen.ts */
  trackPreparation: boolean;
  /** The venue's courier pay rate; null: no pay is accrued (unless a courier has an own rate) */
  courierPay: PayRate | null;
}

const TTL_MS = 30_000;

@Injectable()
export class OrderSettingsService {
  private readonly logger = new Logger(OrderSettingsService.name);
  private cache = new Map<string, { at: number; value: OrderSettings }>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly live?: LiveEventBus,
  ) {
    // Another API process changed the venue: this copy of the cache is stale too
    live?.onInvalidate((orgId) => this.cache.delete(orgId));
  }

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
      deliveryPayment: {
        cash: row.delivery_pay_cash,
        card: row.delivery_pay_card,
        online: row.delivery_pay_online,
      },
      acceptanceTimeoutSeconds: row.acceptance_timeout_seconds,
      paymentTimeoutSeconds: row.payment_timeout_seconds,
      maxActiveOrders: row.max_active_orders,
      pickupReminderMinutes: row.pickup_reminder_minutes,
      onTheWayAlertMinutes: row.on_the_way_alert_minutes,
      doorWaitMinutes: row.door_wait_minutes,
      trackPreparation: row.track_preparation,
      courierPay: payRateOf({
        perDelivery: row.courier_pay_per_delivery,
        includedKm: row.courier_pay_included_km,
        perKm: row.courier_pay_per_km,
      }),
    };

    if (this.cache.size > 1000) this.cache.clear();
    this.cache.set(organizationId, { at: Date.now(), value });
    return value;
  }

  invalidate(organizationId: string) {
    this.cache.delete(organizationId);
    void this.live?.invalidate(organizationId);
  }
}
