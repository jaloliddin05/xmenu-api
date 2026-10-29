import { Logger } from '@nestjs/common';
import { CustomerAuthException } from 'src/modules/auth/errors/customer-auth.exception';
import { OrderSettingsService } from './order-settings.service';

const ROW = {
  organization_id: 'org-1',
  delivery_service_fee: 5000,
  min_order_delivery: 40000,
  min_order_pickup: 0,
  eta_min: 25,
  eta_max: 40,
  acceptance_timeout_seconds: 300,
  payment_timeout_seconds: 900,
  max_active_orders: 3,
  delivery_zone: [
    [41.3, 69.2],
    [41.4, 69.2],
    [41.4, 69.3],
  ],
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
      deliveryServiceFee: 5000,
      minOrderDelivery: 40000,
      minOrderPickup: 0,
      etaMin: 25,
      etaMax: 40,
      acceptanceTimeoutSeconds: 300,
      paymentTimeoutSeconds: 900,
      maxActiveOrders: 3,
      deliveryZone: ROW.delivery_zone,
    });
  });

  it('keeps an unset zone as null', async () => {
    rows['org-1'] = { ...ROW, delivery_zone: null as any };
    await expect(service.get('org-1')).resolves.toMatchObject({
      deliveryZone: null,
    });
  });

  it('refuses a venue without its settings row instead of substituting defaults', async () => {
    const err = await service.get('org-2').catch((e) => e);
    expect(err).toBeInstanceOf(CustomerAuthException);
    expect(err.code).toBe('settings_missing');
    expect(err.getStatus()).toBe(500);
  });
});
