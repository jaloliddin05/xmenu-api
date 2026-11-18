import { Prisma } from '@prisma/client';
import { AppException } from 'src/infra/errors/app-exception';
import { hashWebhookSecret } from 'src/infra/http/webhook-secret';
import { IikoApiError } from '../iiko/iiko-api.client';
import { PosIntegrationService } from './pos-integration.service';
import { PosKeyring } from './pos-keyring';

const ORG = 'org-1';
const KEY_HEX = 'a'.repeat(64);

const dict = {
  terminalGroups: [{ id: 'tg1', name: 'Касса 1' }],
  paymentTypes: [{ id: 'pt-cash', name: 'Наличные', kind: 'Cash' }],
  externalMenus: [{ id: 'm1', name: 'Сайт' }],
  priceCategories: [
    { id: 'pc1', name: 'Доставка' },
    { id: 'pc2', name: 'Зал' },
  ],
};

describe('PosIntegrationService', () => {
  let env: NodeJS.ProcessEnv;
  let row: any;
  let prisma: any;
  let provider: Record<string, jest.Mock>;
  let menu: { import: jest.Mock; preview: jest.Mock };
  let sync: Record<string, jest.Mock | boolean>;
  let api: { forget: jest.Mock };
  let alerts: Record<string, jest.Mock>;
  let stopList: { refresh: jest.Mock };
  let service: PosIntegrationService;

  const ready = () => {
    row = {
      ...row,
      external_org_id: 'o1',
      address_format: 'city',
      external_menu_id: 'm1',
      delivery_item_id: 'i-dlv',
      branch_links: [
        { branch_id: 'b1', terminal_group_id: 'tg1', price_category_id: null },
      ],
      payment_links: [
        {
          method: 'cash',
          payment_type_id: 'pt-cash',
          payment_type_kind: 'Cash',
        },
      ],
    };
  };

  beforeEach(() => {
    env = { ...process.env };
    process.env.IIKO_APP_ID = 'app';
    process.env.IIKO_CLIENT_SECRET = 'secret';
    process.env.PAYMENT_CONFIG_KEY = KEY_HEX;
    process.env.PUBLIC_API_URL = 'https://api.xmenu.uz';
    row = {
      id: 'int-1',
      organization_id: ORG,
      status: 'draft',
      api_key_encrypted: '',
      external_org_id: null,
      address_format: null,
      external_menu_id: null,
      price_category_id: null,
      delivery_item_id: null,
      delivery_size_id: null,
      courier_mode: 'xmenu',
      checks: null,
      branch_links: [],
      payment_links: [],
    };
    prisma = {
      pos_integration: {
        findUnique: jest.fn(async () => row),
        upsert: jest.fn(
          async ({ create }: any) => (row = { ...row, ...create }),
        ),
        update: jest.fn(async ({ data }: any) => Object.assign(row, data)),
        delete: jest.fn(async () => row),
      },
      organization_order_settings: {
        findUnique: jest.fn(async () => ({
          delivery_pay_card: false,
          delivery_pay_online: false,
        })),
      },
      branch: { findMany: jest.fn(async () => [{ id: 'b1' }]) },
      product: { count: jest.fn(async () => 0) },
      customer_order: { count: jest.fn(async () => 0) },
      pos_order: { count: jest.fn(async () => 0) },
      pos_branch_link: { deleteMany: jest.fn(), createMany: jest.fn() },
      pos_payment_link: { deleteMany: jest.fn(), createMany: jest.fn() },
      pos_menu_link: { deleteMany: jest.fn() },
      pos_stop_item: { deleteMany: jest.fn() },
      $executeRaw: jest.fn(async () => 0),
      $executeRawUnsafe: jest.fn(async () => 0),
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    provider = {
      verifyKey: jest.fn(async () => undefined),
      listOrganizations: jest.fn(async () => [{ id: 'o1', name: 'Mant' }]),
      addressFormat: jest.fn(async () => 'city'),
      dictionaries: jest.fn(async () => dict),
      terminalsAlive: jest.fn(async () => new Map([['tg1', true]])),
      checks: jest.fn(async () => [
        { key: 'key_access', status: 'ok' },
        { key: 'delivery_module', status: 'ok' },
        { key: 'terminal_alive', status: 'ok', branchId: 'b1' },
      ]),
      fetchMenu: jest.fn(async () => ({
        categories: [],
        items: [
          { externalId: 'i-dlv', name: 'Доставка', sizes: [], openPrice: true },
        ],
      })),
      setWebhook: jest.fn(async () => undefined),
      clearWebhook: jest.fn(async () => undefined),
    };
    menu = { import: jest.fn(async () => undefined), preview: jest.fn() };
    sync = {
      enabled: true,
      enqueue: jest.fn(async () => undefined),
      schedule: jest.fn(async () => undefined),
      unschedule: jest.fn(async () => undefined),
    };
    api = { forget: jest.fn() };
    alerts = { clear: jest.fn(async () => undefined) };
    stopList = { refresh: jest.fn(async () => undefined) };
    const keyring = new PosKeyring();
    service = new PosIntegrationService(
      prisma,
      provider as any,
      api as any,
      keyring,
      menu as any,
      stopList as any,
      sync as any,
      { addRevalidationJob: jest.fn(async () => undefined) } as any,
      alerts as any,
    );
  });

  afterEach(() => {
    process.env = env;
  });

  describe('key', () => {
    it('without the integrator application: 503 platform_misconfigured (pos), iiko not called', async () => {
      delete process.env.IIKO_APP_ID;
      await expect(service.setKey(ORG, 'k')).rejects.toMatchObject({
        code: 'platform_misconfigured',
        details: { feature: 'pos' },
      });
      expect(provider.verifyKey).not.toHaveBeenCalled();
    });

    it('a key iiko refuses is not stored', async () => {
      prisma.pos_integration.findUnique.mockResolvedValue(null);
      provider.verifyKey.mockRejectedValue(
        new IikoApiError('/api/v2/access_token', 401, null, 'pos_key_invalid'),
      );
      await expect(service.setKey(ORG, 'bad')).rejects.toMatchObject({
        code: 'pos_key_invalid',
      });
      expect(prisma.pos_integration.upsert).not.toHaveBeenCalled();
    });

    it('stores the key encrypted, picks the only organization and never returns the key', async () => {
      prisma.pos_integration.findUnique.mockResolvedValueOnce(null);
      const res = await service.setKey(ORG, ' plain-key ');
      const stored = prisma.pos_integration.upsert.mock.calls[0][0].create;
      expect(stored.api_key_encrypted).toMatch(/^v1:/);
      expect(stored.api_key_encrypted).not.toContain('plain-key');
      expect(provider.addressFormat).toHaveBeenCalledWith(
        expect.anything(),
        'o1',
      );
      expect(JSON.stringify(res)).not.toContain('plain-key');
      expect(res.organizations).toEqual([{ id: 'o1', name: 'Mant' }]);
    });

    it('a new key ends the "key revoked" alert', async () => {
      row.status = 'needs_reconnect';
      row.external_org_id = 'o1';
      await service.setKey(ORG, 'new-key');
      expect(prisma.pos_integration.upsert.mock.calls[0][0].update.status).toBe(
        'active',
      );
      expect(alerts.clear).toHaveBeenCalledWith('int-1', 'key_revoked');
    });

    it('connecting again after disconnecting starts the steps over on the same row', async () => {
      Object.assign(row, {
        status: 'disconnected',
        external_org_id: 'o-old',
        address_format: 'legacy',
        courier_mode: 'iiko',
        api_key_encrypted: null,
        disconnected_at: new Date(),
      });
      prisma.pos_integration.upsert.mockImplementationOnce(
        async ({ update }: any) => Object.assign(row, update),
      );
      const res = await service.setKey(ORG, 'k2');
      const update = prisma.pos_integration.upsert.mock.calls[0][0].update;
      expect(update).toMatchObject({
        status: 'draft',
        courier_mode: 'xmenu',
        disconnected_at: null,
        enabled_at: null,
      });
      // The only organization of the key is chosen again
      expect(row.external_org_id).toBe('o1');
      expect(res).toMatchObject({ connected: true, status: 'draft' });
    });
  });

  describe('links', () => {
    beforeEach(() => {
      row.external_org_id = 'o1';
      row.api_key_encrypted = new PosKeyring().encrypt('k');
    });

    const links = (over: any = {}) => ({
      externalMenuId: 'm1',
      priceCategoryId: 'pc1',
      branches: [{ branchId: 'b1', terminalGroupId: 'tg1' }],
      payments: [{ method: 'cash' as const, paymentTypeId: 'pt-cash' }],
      deliveryItem: { itemId: 'i-dlv' },
      ...over,
    });

    it('a price category per branch; one iiko does not know is a field error', async () => {
      prisma.branch.findMany.mockResolvedValue([{ id: 'b1' }, { id: 'b2' }]);
      await service.setLinks(
        ORG,
        links({
          branches: [
            { branchId: 'b1', terminalGroupId: 'tg1', priceCategoryId: 'pc2' },
            { branchId: 'b2', terminalGroupId: 'tg1' },
          ],
        }),
      );
      expect(prisma.pos_branch_link.createMany).toHaveBeenCalledWith({
        data: [
          {
            integration_id: 'int-1',
            branch_id: 'b1',
            terminal_group_id: 'tg1',
            price_category_id: 'pc2',
          },
          {
            integration_id: 'int-1',
            branch_id: 'b2',
            terminal_group_id: 'tg1',
            price_category_id: null,
          },
        ],
      });
      prisma.branch.findMany.mockResolvedValue([{ id: 'b1' }]);
      await expect(
        service.setLinks(
          ORG,
          links({
            branches: [
              {
                branchId: 'b1',
                terminalGroupId: 'tg1',
                priceCategoryId: 'pc-x',
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({
        code: 'pos_links_invalid',
        fields: [
          expect.objectContaining({
            field: 'branches[0].priceCategoryId',
            code: 'unknown_price_category',
          }),
        ],
      });
    });

    it('ids iiko does not know are field errors', async () => {
      const e = await service
        .setLinks(
          ORG,
          links({
            branches: [{ branchId: 'b1', terminalGroupId: 'tg-x' }],
            payments: [{ method: 'cash', paymentTypeId: 'pt-x' }],
            deliveryItem: { itemId: 'i-x' },
          }),
        )
        .catch((x: AppException) => x);
      expect((e as AppException).fields!.map((f) => f.field)).toEqual([
        'branches[0].terminalGroupId',
        'payments[0].paymentTypeId',
        'deliveryItem.itemId',
      ]);
      expect(prisma.pos_branch_link.createMany).not.toHaveBeenCalled();
    });

    it("another venue's branch is 404", async () => {
      prisma.branch.findMany.mockResolvedValue([]);
      await expect(service.setLinks(ORG, links())).rejects.toMatchObject({
        code: 'not_found',
      });
    });

    it('a menu iiko no longer has is pos_external_menu_missing', async () => {
      await expect(
        service.setLinks(ORG, links({ externalMenuId: 'gone' })),
      ).rejects.toMatchObject({ code: 'pos_external_menu_missing' });
    });

    it('saves links with the payment type kind', async () => {
      await service.setLinks(ORG, links());
      expect(prisma.pos_payment_link.createMany).toHaveBeenCalledWith({
        data: [
          {
            integration_id: 'int-1',
            method: 'cash',
            payment_type_id: 'pt-cash',
            payment_type_kind: 'Cash',
          },
        ],
      });
      expect(row).toMatchObject({
        external_menu_id: 'm1',
        price_category_id: 'pc1',
        delivery_item_id: 'i-dlv',
      });
    });
  });

  describe('enable', () => {
    beforeEach(() => {
      row.api_key_encrypted = new PosKeyring().encrypt('k');
    });

    it('lists the unfinished steps and red checks, imports nothing', async () => {
      row.external_org_id = 'o1';
      row.address_format = 'city';
      provider.checks.mockResolvedValue([
        { key: 'key_access', status: 'ok' },
        { key: 'delivery_module', status: 'fail', code: 'pos_module_missing' },
      ]);
      await expect(service.enable(ORG, [])).rejects.toMatchObject({
        code: 'pos_setup_incomplete',
        details: {
          missing: [
            'step:branches',
            'step:payments',
            'step:menu',
            'check:delivery_module',
          ],
        },
      });
      expect(menu.import).not.toHaveBeenCalled();
      expect(provider.setWebhook).not.toHaveBeenCalled();
    });

    it("pairs with another venue's dish are 404", async () => {
      ready();
      await expect(
        service.enable(ORG, [{ productId: 'p-theirs', itemId: 'i1' }]),
      ).rejects.toMatchObject({ code: 'not_found' });
      expect(menu.import).not.toHaveBeenCalled();
    });

    it('imports with the pairs, sets the webhook on the integration id with a hashed secret, schedules', async () => {
      ready();
      prisma.product.count.mockResolvedValue(1);
      const res = await service.enable(ORG, [
        { productId: 'p1', itemId: null },
      ]);
      // The first connection pairs (a regular import does not)
      expect(menu.import).toHaveBeenCalledWith(expect.anything(), {
        pairing: true,
        matches: [{ productId: 'p1', itemId: null }],
      });
      const [, orgId, url, secret] = provider.setWebhook.mock.calls[0];
      expect(orgId).toBe('o1');
      expect(url).toBe('https://api.xmenu.uz/pos/iiko/int-1/webhook');
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      expect(row.webhook_secret_hash).toBe(hashWebhookSecret(secret));
      expect(row.status).toBe('active');
      expect(sync.schedule).toHaveBeenCalledWith('int-1');
      expect(JSON.stringify(res)).not.toContain(secret);
      expect(JSON.stringify(res)).not.toContain('/webhook');
    });

    it('a failed import leaves the integration a draft without a webhook', async () => {
      ready();
      menu.import.mockRejectedValue(new AppException('pos_unavailable'));
      await expect(service.enable(ORG, [])).rejects.toMatchObject({
        code: 'pos_unavailable',
      });
      expect(provider.setWebhook).not.toHaveBeenCalled();
      expect(row.status).toBe('draft');
    });
  });

  it('courier mode does not change with open delivery orders', async () => {
    prisma.customer_order.count.mockResolvedValue(2);
    await expect(service.setCourierMode(ORG, 'iiko')).rejects.toMatchObject({
      code: 'pos_courier_mode_locked',
    });
    prisma.customer_order.count.mockResolvedValue(0);
    await service.setCourierMode(ORG, 'iiko');
    expect(row.courier_mode).toBe('iiko');
  });

  describe('disconnect', () => {
    beforeEach(() => {
      ready();
      row.status = 'active';
      row.api_key_encrypted = new PosKeyring().encrypt('k');
      row.webhook_secret_hash = 'h';
    });

    it('keeps the integration and its orders: links, menu links, stop list and key go; iiko failing does not stop it', async () => {
      provider.clearWebhook.mockRejectedValue(new Error('down'));
      prisma.pos_order.count.mockResolvedValue(2);
      await expect(service.disconnect(ORG)).resolves.toEqual({
        connected: false,
        unfinishedOrders: 2,
      });
      expect(prisma.pos_integration.delete).not.toHaveBeenCalled();
      const where = { where: { integration_id: 'int-1' } };
      expect(prisma.pos_menu_link.deleteMany).toHaveBeenCalledWith(where);
      expect(prisma.pos_stop_item.deleteMany).toHaveBeenCalledWith(where);
      expect(prisma.pos_branch_link.deleteMany).toHaveBeenCalledWith(where);
      expect(prisma.pos_payment_link.deleteMany).toHaveBeenCalledWith(where);
      expect(row).toMatchObject({
        status: 'disconnected',
        api_key_encrypted: null,
        webhook_secret_hash: null,
      });
      expect(row.disconnected_at).toBeInstanceOf(Date);
      // Unfinished = already in iiko (being sent or sent), order not finished
      expect(prisma.pos_order.count).toHaveBeenCalledWith({
        where: {
          integration_id: 'int-1',
          state: { in: ['sending', 'sent'] },
          order: { status: { in: expect.any(Array) } },
        },
      });
      expect(provider.clearWebhook).toHaveBeenCalledWith(
        { integrationId: 'int-1', apiKey: 'k' },
        'o1',
      );
      expect(sync.unschedule).toHaveBeenCalledWith('int-1');
      expect(api.forget).toHaveBeenCalledWith('int-1');
    });

    it('waits for the integration lock up to 10 s; still busy: 409 pos_busy and nothing changes', async () => {
      prisma.$executeRaw.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('lock timeout', {
          code: 'P2010',
          clientVersion: 'test',
          meta: {
            code: '55P03',
            message: 'canceling statement due to lock timeout',
          },
        }),
      );
      await expect(service.disconnect(ORG)).rejects.toMatchObject({
        code: 'pos_busy',
      });
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'SET LOCAL lock_timeout = 10000',
      );
      expect(prisma.pos_menu_link.deleteMany).not.toHaveBeenCalled();
      expect(row.status).toBe('active');
      expect(provider.clearWebhook).not.toHaveBeenCalled();
      expect(sync.unschedule).not.toHaveBeenCalled();
    });

    it('a disconnected integration reads as not connected; disconnecting again is a no-op', async () => {
      await service.disconnect(ORG);
      await expect(service.status(ORG)).resolves.toMatchObject({
        connected: false,
        status: null,
      });
      await expect(service.disconnect(ORG)).resolves.toEqual({
        connected: false,
        unfinishedOrders: 0,
      });
      expect(provider.clearWebhook).toHaveBeenCalledTimes(1);
      await expect(service.importNow(ORG)).rejects.toMatchObject({
        code: 'pos_not_connected',
      });
    });
  });

  describe('match again', () => {
    beforeEach(() => {
      ready();
      row.api_key_encrypted = new PosKeyring().encrypt('k');
    });

    it('imports pairing the dishes without a link, then refreshes the stop list', async () => {
      row.status = 'active';
      prisma.product.count.mockResolvedValue(1);
      await service.rematch(ORG, [{ productId: 'p1', itemId: 'i1' }]);
      expect(menu.import).toHaveBeenCalledWith(expect.anything(), {
        pairing: true,
        matches: [{ productId: 'p1', itemId: 'i1' }],
      });
      expect(stopList.refresh).toHaveBeenCalledWith('int-1');
    });

    it("not enabled yet: 409; another venue's dish: 404", async () => {
      await expect(service.rematch(ORG, [])).rejects.toMatchObject({
        code: 'pos_setup_incomplete',
      });
      row.status = 'active';
      await expect(
        service.rematch(ORG, [{ productId: 'p-theirs', itemId: null }]),
      ).rejects.toMatchObject({ code: 'not_found' });
      expect(menu.import).not.toHaveBeenCalled();
    });
  });

  describe('alert and availability', () => {
    it('the alert of the integration is in the status', async () => {
      const at = new Date();
      Object.assign(row, { alert: 'menu_import_failed', alert_at: at });
      await expect(service.status(ORG)).resolves.toMatchObject({
        available: true,
        alert: { code: 'menu_import_failed', at },
      });
    });

    it('without the platform iiko application: available false before the owner types a key', async () => {
      delete process.env.IIKO_CLIENT_SECRET;
      prisma.pos_integration.findUnique.mockResolvedValue(null);
      await expect(service.status(ORG)).resolves.toMatchObject({
        available: false,
        connected: false,
      });
    });

    it('without a usable key storage: available false', async () => {
      process.env.PAYMENT_CONFIG_KEY = 'short';
      prisma.pos_integration.findUnique.mockResolvedValue(null);
      await expect(service.status(ORG)).resolves.toMatchObject({
        available: false,
      });
    });
  });

  it('status without an integration', async () => {
    prisma.pos_integration.findUnique.mockResolvedValue(null);
    await expect(service.status(ORG)).resolves.toMatchObject({
      connected: false,
      status: null,
      steps: null,
    });
  });
});
