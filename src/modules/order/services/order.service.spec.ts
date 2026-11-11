import { AppException } from 'src/infra/errors/app-exception';
import { hashOrderRequest } from '../domain/order-money';
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

/** POST /orders up to the branch choice: the ordering gate sits before it. */
describe('OrderService.create: ordering channel and publication', () => {
  let org: {
    delivery_enabled: boolean;
    published_at: Date | null;
    delivery_mode: 'site' | 'miniapp' | 'both';
  } | null;
  let hasBot: boolean;
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
    miniAppAccess({ mode: () => org!.delivery_mode, hasBot: () => hasBot }),
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
      expect(listActiveWithState).not.toHaveBeenCalled();
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
      expect(listActiveWithState).not.toHaveBeenCalled();
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
    // null: the order goes on to the branch choice (no branches in this fake)
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
            expect(listActiveWithState).not.toHaveBeenCalled();
          } else {
            expect(listActiveWithState).toHaveBeenCalledWith(TENANT);
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
    '%s: a published venue goes on to the branch choice',
    async (mode) => {
      const result = await codeOf(mode);
      expect(listActiveWithState).toHaveBeenCalledWith(TENANT);
      // No branches in this fake: the next check answers, not the ordering gate
      expect(result?.code).not.toMatch(/^ordering_/);
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
