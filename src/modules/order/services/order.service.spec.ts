import { CustomerAuthException } from 'src/modules/auth/errors/customer-auth.exception';
import { hashOrderRequest } from '../domain/order-money';
import { OrderService } from './order.service';
import * as orderView from './order-view';

const TENANT = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const principal = { tenantId: TENANT, customerId: 'cust-1' } as any;
const tenant = { currency: 'UZS', defaultLanguage: 'ru' as const };
const KEY = 'idem-key-0001';

const dto = (fulfillmentMode: 'delivery' | 'pickup') =>
  ({
    fulfillmentMode,
    branchId: fulfillmentMode === 'pickup' ? 'b1' : undefined,
    addressId: fulfillmentMode === 'delivery' ? 'a1' : undefined,
    paymentMethod: 'cash',
    items: [{ itemId: 'p1', quantity: 1 }],
  }) as any;

/** POST /orders up to the branch choice: the ordering gate sits before it. */
describe('OrderService.create: ordering channel and publication', () => {
  let org: { delivery_enabled: boolean; published_at: Date | null } | null;
  let existing: unknown;
  const listActiveWithState = jest.fn(async () => []);
  const prisma = {
    customer_order: { findUnique: jest.fn(async () => existing) },
    customer: {
      findFirst: jest.fn(async () => ({ id: 'cust-1', status: 'active' })),
    },
    organization: { findUnique: jest.fn(async () => org) },
    order_status_event: { findFirst: jest.fn() },
  };
  const service = new OrderService(
    prisma as any,
    { get: jest.fn(async () => ({ deliveryZone: null })) } as any,
    { listActiveWithState } as any,
    {} as any,
    {} as any,
    { buildUrl: jest.fn() } as any,
  );

  const create = (mode: 'delivery' | 'pickup') =>
    service.create(principal, dto(mode), KEY, 'ru', tenant);
  const codeOf = (mode: 'delivery' | 'pickup') =>
    create(mode).then(
      () => null,
      (e: CustomerAuthException) => ({
        code: e.code,
        status: e.getStatus(),
      }),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    existing = null;
    org = { delivery_enabled: true, published_at: new Date() };
  });

  it.each(['delivery', 'pickup'] as const)(
    '%s: 422 ordering_channel_disabled while ordering is off',
    async (mode) => {
      org = { delivery_enabled: false, published_at: null };
      expect(await codeOf(mode)).toEqual({
        code: 'ordering_channel_disabled',
        status: 422,
      });
      expect(listActiveWithState).not.toHaveBeenCalled();
    },
  );

  it.each(['delivery', 'pickup'] as const)(
    '%s: 422 ordering_not_published while not published or paused',
    async (mode) => {
      org = { delivery_enabled: true, published_at: null };
      expect(await codeOf(mode)).toEqual({
        code: 'ordering_not_published',
        status: 422,
      });
      expect(listActiveWithState).not.toHaveBeenCalled();
    },
  );

  it('reads the state fresh from the organization of the token', async () => {
    await codeOf('pickup');
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: TENANT },
      select: { delivery_enabled: true, published_at: true },
    });
  });

  it.each(['delivery', 'pickup'] as const)(
    '%s: a published venue goes on to the branch choice',
    async (mode) => {
      const result = await codeOf(mode);
      expect(listActiveWithState).toHaveBeenCalledWith(TENANT);
      // No branches in this fake: the next check answers, not the ordering gate
      expect(result?.code).not.toMatch(/^ordering_/);
    },
  );

  it('a blocked customer is told so before the venue state', async () => {
    org = { delivery_enabled: false, published_at: null };
    prisma.customer.findFirst.mockResolvedValueOnce({
      id: 'cust-1',
      status: 'blocked',
    });
    expect((await codeOf('pickup'))?.code).toBe('customer_blocked');
  });

  it('replaying an order created before the pause still returns it', async () => {
    org = { delivery_enabled: true, published_at: null };
    existing = {
      id: 'o1',
      request_hash: hashOrderRequest(dto('pickup')),
      status: 'pending_acceptance',
    };
    const toOrderView = jest
      .spyOn(orderView, 'toOrderView')
      .mockReturnValue({ id: 'o1' } as any);
    await expect(create('pickup')).resolves.toEqual({ id: 'o1' });
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    toOrderView.mockRestore();
  });
});
