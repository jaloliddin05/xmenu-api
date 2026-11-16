import { Logger } from '@nestjs/common';
import { AppException } from 'src/infra/errors/app-exception';
import { OrderSettingsService } from './order-settings.service';

const ROW = {
  organization_id: 'org-1',
  min_order_pickup: 0,
  delivery_price_step: 500,
  courier_mode: 'both',
  delivery_pay_cash: true,
  delivery_pay_card: true,
  delivery_pay_online: false,
  acceptance_timeout_seconds: 300,
  payment_timeout_seconds: 900,
  max_active_orders: 3,
  pickup_reminder_minutes: 5,
  on_the_way_alert_minutes: 60,
  door_wait_minutes: 10,
  courier_pay_per_delivery: 10000 as number | null,
  courier_pay_included_km: 3 as number | null,
  courier_pay_per_km: 2000 as number | null,
};

describe('OrderSettingsService.get', () => {
  let rows: Record<string, typeof ROW>;
  let service: OrderSettingsService;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    rows = { 'org-1': { ...ROW } };
    const findUnique = jest.fn(
      async ({ where }) => rows[where.organization_id] ?? null,
    );
    service = new OrderSettingsService({
      organization_order_settings: { findUnique },
    } as any);
  });

  it('maps the stored row', async () => {
    await expect(service.get('org-1')).resolves.toEqual({
      minOrderPickup: 0,
      deliveryPriceStep: 500,
      courierMode: 'both',
      deliveryPayment: { cash: true, card: true, online: false },
      acceptanceTimeoutSeconds: 300,
      paymentTimeoutSeconds: 900,
      maxActiveOrders: 3,
      pickupReminderMinutes: 5,
      onTheWayAlertMinutes: 60,
      doorWaitMinutes: 10,
      courierPay: { perDelivery: 10000, includedKm: 3, perKm: 2000 },
    });
  });

  it('a courier pay rate with any part missing is no rate', async () => {
    rows['org-1'].courier_pay_per_km = null;
    expect((await service.get('org-1')).courierPay).toBeNull();
  });

  it('refuses a venue without its settings row instead of substituting defaults', async () => {
    const err = await service.get('org-2').catch((e) => e);
    expect(err).toBeInstanceOf(AppException);
    expect(err.code).toBe('settings_missing');
    expect(err.getStatus()).toBe(500);
  });
});
