import { AppException } from 'src/infra/errors/app-exception';
import { hashOrderRequest } from '../domain/order-money';
import * as orderPricing from '../domain/order-pricing';
import { OrderService } from './order.service';
import * as orderView from './order-view';
import {
  INIT_DATA_CASES,
  InitDataCase,
  miniAppAccess,
} from 'src/modules/auth/services/init-data.fake';

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

/** POST /orders up to pricing: the ordering gate sits before it. */
describe('OrderService.create: ordering channel and publication', () => {
  let org: {
    delivery_enabled: boolean;
    published_at: Date | null;
    delivery_mode: 'site' | 'miniapp' | 'both';
  } | null;
  let hasBot: boolean;
  let existing: unknown;
  // No products in this fake: an order that passes the gate stops at pricing (item_unavailable)
  const findProducts = jest.fn(async () => []);
  const prisma = {
    customer_order: { findUnique: jest.fn(async () => existing) },
    customer: {
      findFirst: jest.fn(async () => ({ id: 'cust-1', status: 'active' })),
    },
    organization: { findUnique: jest.fn(async () => org) },
    order_status_event: { findFirst: jest.fn() },
    product: { findMany: findProducts },
  };
  const service = new OrderService(
    prisma as any,
    { get: jest.fn(async () => ({ minOrderPickup: 0 })) } as any,
    {} as any,
    {} as any,
    {} as any,
    { buildUrl: jest.fn() } as any,
    miniAppAccess({ mode: () => org!.delivery_mode, hasBot: () => hasBot }),
    {} as any,
  );

  const create = (mode: 'delivery' | 'pickup', initData?: string) =>
    service.create(principal, dto(mode), KEY, 'ru', tenant, initData);
  const codeOf = (mode: 'delivery' | 'pickup', initData?: string) =>
    create(mode, initData).then(
      () => null,
      (e: AppException) => ({
        code: e.code,
        status: e.getStatus(),
      }),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    existing = null;
    hasBot = true;
    org = {
      delivery_enabled: true,
      published_at: new Date(),
      delivery_mode: 'site',
    };
  });

  it.each(['delivery', 'pickup'] as const)(
    '%s: 422 ordering_channel_disabled while ordering is off',
    async (mode) => {
      org = {
        delivery_enabled: false,
        published_at: null,
        delivery_mode: 'site',
      };
      expect(await codeOf(mode)).toEqual({
        code: 'ordering_channel_disabled',
        status: 422,
      });
      expect(findProducts).not.toHaveBeenCalled();
    },
  );

  it.each(['delivery', 'pickup'] as const)(
    '%s: 422 ordering_not_published while not published or paused',
    async (mode) => {
      org = {
        delivery_enabled: true,
        published_at: null,
        delivery_mode: 'site',
      };
      expect(await codeOf(mode)).toEqual({
        code: 'ordering_not_published',
        status: 422,
      });
      expect(findProducts).not.toHaveBeenCalled();
    },
  );

  it('reads the state fresh from the organization of the token', async () => {
    await codeOf('pickup');
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: TENANT },
      select: {
        delivery_enabled: true,
        published_at: true,
        delivery_mode: true,
      },
    });
  });

  describe('delivery mode (X-Telegram-Init-Data)', () => {
    type Mode = 'site' | 'miniapp' | 'both';
    // null: the order goes on to pricing (no products in this fake)
    const expected: Record<Mode, Record<InitDataCase, string | null>> = {
      site: {
        absent: null,
        forged: null,
        expired: null,
        foreignBot: null,
        valid: null,
      },
      miniapp: {
        absent: '403 miniapp_required',
        forged: '403 miniapp_init_data_invalid',
        expired: '403 miniapp_init_data_invalid',
        foreignBot: '403 miniapp_init_data_invalid',
        valid: null,
      },
      both: {
        absent: null,
        forged: '403 miniapp_init_data_invalid',
        expired: '403 miniapp_init_data_invalid',
        foreignBot: '403 miniapp_init_data_invalid',
        valid: null,
      },
    };

    describe.each(Object.keys(expected) as Mode[])('mode %s', (mode) => {
      it.each(Object.keys(INIT_DATA_CASES) as InitDataCase[])(
        'initData %s',
        async (c) => {
          org!.delivery_mode = mode;
          const result = await codeOf('pickup', INIT_DATA_CASES[c]());
          const want = expected[mode][c];
          if (want) {
            expect(result && `${result.status} ${result.code}`).toBe(want);
            expect(findProducts).not.toHaveBeenCalled();
          } else {
            expect(findProducts).toHaveBeenCalled();
          }
        },
      );
    });

    it('miniapp after the bot was removed: 503 telegram_unavailable', async () => {
      org!.delivery_mode = 'miniapp';
      hasBot = false;
      expect(await codeOf('pickup', INIT_DATA_CASES.valid())).toEqual({
        code: 'telegram_unavailable',
        status: 503,
      });
    });

    it('a paused venue answers its pause first, whatever the mode', async () => {
      org = {
        delivery_enabled: true,
        published_at: null,
        delivery_mode: 'miniapp',
      };
      expect((await codeOf('pickup'))?.code).toBe('ordering_not_published');
    });
  });

  it.each(['delivery', 'pickup'] as const)(
    '%s: a published venue goes on to pricing',
    async (mode) => {
      const result = await codeOf(mode);
      expect(findProducts).toHaveBeenCalled();
      // No products in this fake: the next check answers, not the ordering gate
      expect(result?.code).toBe('item_unavailable');
    },
  );

  it('a blocked customer is told so before the venue state', async () => {
    org = {
      delivery_enabled: false,
      published_at: null,
      delivery_mode: 'site',
    };
    prisma.customer.findFirst.mockResolvedValueOnce({
      id: 'cust-1',
      status: 'blocked',
    });
    expect((await codeOf('pickup'))?.code).toBe('customer_blocked');
  });

  it('replaying an order created before the pause still returns it', async () => {
    org = {
      delivery_enabled: true,
      published_at: null,
      delivery_mode: 'site',
    };
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

/** POST /orders past the gate: branch, delivery fee, payment method, change and price checks. */
describe('OrderService.create: delivery price, payment and change', () => {
  const SUBTOTAL = 60000;
  let settings: { minOrderPickup: number; courierMode: string };
  let choice: {
    branch: { id: string; title: string; address: string };
    price: {
      deliveryFee: number;
      freeFrom: number | null;
      minOrder: number;
    };
  };
  let created: Record<string, any> | undefined;
  const choose = jest.fn(async () => choice);
  const listActiveWithState = jest.fn(async () => [
    {
      branch: { id: 'b1', accepts_pickup: true, accepts_delivery: true },
      scheduled: true,
      state: { isOpen: true, opensAt: null, opensDate: null },
      opensAt: null,
    },
  ]);
  const tx = {
    $queryRaw: jest.fn(async () => [{ order_seq: 7 }]),
    customer_order: {
      create: jest.fn(async ({ data }) => {
        created = data;
        return { id: 'o1', ...data, items: [], branch: {} };
      }),
    },
    order_status_event: { create: jest.fn() },
  };
  const prisma = {
    customer_order: {
      findUnique: jest.fn(async () => null),
      count: jest.fn(async () => 0),
    },
    customer: {
      findFirst: jest.fn(async () => ({ id: 'cust-1', status: 'active' })),
    },
    organization: {
      findUnique: jest.fn(async () => ({
        delivery_enabled: true,
        published_at: new Date(),
        delivery_mode: 'site',
      })),
    },
    customer_address: {
      findFirst: jest.fn(async () => ({
        id: 'a1',
        address: 'Tashkent',
        latitude: 41.3,
        longitude: 69.25,
        created_at: new Date(),
      })),
    },
    product: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const service = new OrderService(
    prisma as any,
    {
      get: jest.fn(async () => ({
        ...settings,
        maxActiveOrders: 5,
        paymentTimeoutSeconds: 900,
      })),
    } as any,
    { listActiveWithState } as any,
    { dispatchEffects: jest.fn() } as any,
    { enabledProviders: jest.fn(async () => new Set(['click'])) } as any,
    { buildUrl: jest.fn(async () => 'https://pay.example') } as any,
    miniAppAccess({ mode: () => 'site', hasBot: () => true }),
    { choose } as any,
  );

  const order = (over: Record<string, unknown> = {}) => ({
    ...dto('delivery'),
    ...over,
  });
  const run = (body: any) =>
    service.create(principal, body, KEY, 'ru', tenant).then(
      () => null,
      (e: AppException) => {
        if (!(e instanceof AppException)) throw e;
        return {
          code: e.code,
          status: e.getStatus(),
          body: e.getResponse() as any,
        };
      },
    );

  beforeAll(() => {
    jest.spyOn(orderPricing, 'priceLines').mockReturnValue({
      lines: [],
      subtotal: SUBTOTAL,
    });
    jest
      .spyOn(orderView, 'toOrderView')
      .mockImplementation((o: any) => ({ id: o.id }) as any);
  });
  afterAll(() => jest.restoreAllMocks());

  beforeEach(() => {
    jest.clearAllMocks();
    created = undefined;
    settings = { minOrderPickup: 0, courierMode: 'own' };
    choice = {
      branch: { id: 'near', title: 'Near', address: 'Street 1' },
      price: { deliveryFee: 12000, freeFrom: 150000, minOrder: 50000 },
    };
  });

  it('delivery: the branch and fee chosen for the address are fixed in the order', async () => {
    expect(await run(order())).toBeNull();
    expect(choose).toHaveBeenCalledWith(TENANT, [41.3, 69.25], SUBTOTAL);
    expect(created).toMatchObject({
      branch_id: 'near',
      delivery_fee: 12000,
      subtotal: SUBTOTAL,
      total: SUBTOTAL + 12000,
      cash_change_from: null,
    });
    expect(listActiveWithState).not.toHaveBeenCalled();
  });

  it('delivery: the branchId hint is ignored', async () => {
    await run(order({ branchId: 'b1' }));
    expect(created?.branch_id).toBe('near');
  });

  it('delivery: an address without coordinates is passed as no point', async () => {
    prisma.customer_address.findFirst.mockResolvedValueOnce({
      id: 'a1',
      address: 'Tashkent',
      latitude: null,
      longitude: null,
      created_at: new Date(),
    } as any);
    await run(order());
    expect(choose).toHaveBeenCalledWith(TENANT, null, SUBTOTAL);
  });

  it('delivery: the reason of the branch choice is the answer', async () => {
    choose.mockRejectedValueOnce(new AppException('out_of_delivery_zone'));
    expect((await run(order()))?.code).toBe('out_of_delivery_zone');
    expect(created).toBeUndefined();
  });

  it('pickup: the chosen branch, no delivery fee, the pickup minimum', async () => {
    settings.minOrderPickup = 70000;
    const r = await run({ ...dto('pickup') });
    expect(r?.code).toBe('min_order_not_reached');
    expect(r?.body.details).toEqual({ minAmount: 70000, shortBy: 10000 });
    settings.minOrderPickup = 0;
    expect(await run({ ...dto('pickup') })).toBeNull();
    expect(created).toMatchObject({ branch_id: 'b1', delivery_fee: 0 });
    expect(choose).not.toHaveBeenCalled();
  });

  it('delivery fee changed since the quote: 409 delivery_fee_changed with the new price', async () => {
    const r = await run(order({ expectedDeliveryFee: 10000 }));
    expect(r?.status).toBe(409);
    expect(r?.code).toBe('delivery_fee_changed');
    expect(r?.body.details).toEqual({
      deliveryFee: 12000,
      freeFrom: 150000,
      minOrder: 50000,
      total: SUBTOTAL + 12000,
    });
    expect(created).toBeUndefined();
  });

  it('the fee the guest saw still applies: the order is placed', async () => {
    expect(
      await run(
        order({ expectedDeliveryFee: 12000, expectedTotal: SUBTOTAL + 12000 }),
      ),
    ).toBeNull();
  });

  it('free delivery became paid between the cart and the order: delivery_fee_changed', async () => {
    expect((await run(order({ expectedDeliveryFee: 0 })))?.code).toBe(
      'delivery_fee_changed',
    );
  });

  it('price_changed carries the delivery fee', async () => {
    const r = await run(order({ expectedTotal: 1 }));
    expect(r?.code).toBe('price_changed');
    expect(r?.body.details).toMatchObject({
      subtotal: SUBTOTAL,
      deliveryFee: 12000,
      total: SUBTOTAL + 12000,
    });
  });

  it('below the minimum of the applied rule: min_order_not_reached with shortBy', async () => {
    choice.price.minOrder = 80000;
    const r = await run(order());
    expect(r?.code).toBe('min_order_not_reached');
    expect(r?.body.details).toEqual({ minAmount: 80000, shortBy: 20000 });
  });

  describe('cash and courier mode', () => {
    it('external couriers only: cash on delivery is refused', async () => {
      settings.courierMode = 'external';
      const r = await run(order());
      expect(r).toMatchObject({
        code: 'payment_method_unavailable',
        status: 422,
      });
      expect(choose).toHaveBeenCalled();
      expect(created).toBeUndefined();
    });

    it('external couriers only: online payment for delivery and cash for pickup still work', async () => {
      settings.courierMode = 'external';
      expect(await run(order({ paymentMethod: 'click' }))).toBeNull();
      expect(await run({ ...dto('pickup') })).toBeNull();
    });

    it.each(['own', 'both'])(
      '%s couriers: cash on delivery works',
      async (mode) => {
        settings.courierMode = mode;
        expect(await run(order())).toBeNull();
      },
    );
  });

  describe('cashChangeFrom', () => {
    it('is stored for cash, equal to the total is enough', async () => {
      expect(await run(order({ cashChangeFrom: SUBTOTAL + 12000 }))).toBeNull();
      expect(created?.cash_change_from).toBe(SUBTOTAL + 12000);
      expect(await run(order({ cashChangeFrom: 200000 }))).toBeNull();
      expect(created?.cash_change_from).toBe(200000);
    });

    it('below the total (with delivery): 400 validation_error on the field', async () => {
      const r = await run(order({ cashChangeFrom: SUBTOTAL }));
      expect(r?.code).toBe('validation_error');
      expect(r?.body.fields).toEqual([
        expect.objectContaining({
          field: 'cashChangeFrom',
          code: 'below_total',
        }),
      ]);
    });

    it('only with cash', async () => {
      const r = await run(
        order({ paymentMethod: 'click', cashChangeFrom: 200000 }),
      );
      expect(r?.body.fields).toEqual([
        expect.objectContaining({ field: 'cashChangeFrom', code: 'cash_only' }),
      ]);
    });
  });
});
