import { Logger } from '@nestjs/common';
import { AppException } from 'src/infra/errors/app-exception';
import { OrderSettingsService } from './order-settings.service';

const ROW = {
  organization_id: 'org-1',
  min_order_pickup: 0,
  delivery_price_step: 500,
  courier_mode: 'both',
  acceptance_timeout_seconds: 300,
  payment_timeout_seconds: 900,
  max_active_orders: 3,
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
      acceptanceTimeoutSeconds: 300,
      paymentTimeoutSeconds: 900,
      maxActiveOrders: 3,
    });
  });

  it('refuses a venue without its settings row instead of substituting defaults', async () => {
    const err = await service.get('org-2').catch((e) => e);
    expect(err).toBeInstanceOf(AppException);
    expect(err.code).toBe('settings_missing');
    expect(err.getStatus()).toBe(500);
  });
});
