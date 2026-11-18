import { AppException } from 'src/infra/errors/app-exception';
import {
  IikoApiClient,
  IikoApiError,
  iikoErrorText,
  jwtExpiry,
  toAppException,
} from './iiko-api.client';
import { IikoProvider, iikoAddressFormat } from './iiko.provider';
import { FakeIikoServer, fakeIikoToken } from './iiko-server.fake';

const KEY = 'restaurant-secret-key';
const cred = { integrationId: 'int-1', apiKey: KEY };
const hourFromNow = () => Math.floor(Date.now() / 1000) + 3600;

describe('IikoApiClient', () => {
  let iiko: FakeIikoServer;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    env = { ...process.env };
    iiko = await new FakeIikoServer().start();
    process.env.IIKO_API_BASE_URL = iiko.url;
    process.env.IIKO_APP_ID = 'app-id';
    process.env.IIKO_CLIENT_SECRET = 'client-secret';
  });

  afterEach(async () => {
    process.env = env;
    await iiko.stop();
  });

  it('gets the token with the three fields and sends it as Bearer', async () => {
    const token = fakeIikoToken(hourFromNow());
    iiko
      .on('/api/v2/access_token', { body: { correlationId: 'c', token } })
      .on('/api/2/menu', { body: { externalMenus: [] } });
    const client = new IikoApiClient();
    await client.call(cred, '/api/2/menu', {});
    expect(iiko.callsTo('/api/v2/access_token')[0].body).toEqual({
      appId: 'app-id',
      clientSecret: 'client-secret',
      apiKey: KEY,
    });
    expect(iiko.callsTo('/api/2/menu')[0].authorization).toBe(
      `Bearer ${token}`,
    );
  });

  it('remembers when a token was last issued (the integrator application works)', async () => {
    iiko
      .on('/api/v2/access_token', {
        body: { token: fakeIikoToken(hourFromNow()) },
      })
      .on('/api/2/menu', { body: {} });
    const client = new IikoApiClient();
    expect(client.lastTokenIssuedAt).toBe(0);
    const before = Date.now();
    await client.call(cred, '/api/2/menu', {});
    expect(client.lastTokenIssuedAt).toBeGreaterThanOrEqual(before);
  });

  it('keeps the token until shortly before exp, and asks again for a new key', async () => {
    iiko
      .on('/api/v2/access_token', {
        body: { token: fakeIikoToken(hourFromNow()) },
      })
      .on('/api/2/menu', { body: {} });
    const client = new IikoApiClient();
    await client.call(cred, '/api/2/menu', {});
    await client.call(cred, '/api/2/menu', {});
    expect(iiko.callsTo('/api/v2/access_token')).toHaveLength(1);
    await client.call({ ...cred, apiKey: 'another' }, '/api/2/menu', {});
    expect(iiko.callsTo('/api/v2/access_token')).toHaveLength(2);
  });

  it('a token about to expire is renewed', async () => {
    iiko
      .on('/api/v2/access_token', {
        body: { token: fakeIikoToken(Math.floor(Date.now() / 1000) + 60) },
      })
      .on('/api/2/menu', { body: {} });
    const client = new IikoApiClient();
    await client.call(cred, '/api/2/menu', {});
    await client.call(cred, '/api/2/menu', {});
    expect(iiko.callsTo('/api/v2/access_token')).toHaveLength(2);
  });

  it('on 401 the token is requested again once and the call repeated', async () => {
    let n = 0;
    iiko
      .on('/api/v2/access_token', () => ({
        body: { token: fakeIikoToken(hourFromNow(), `t${++n}`) },
      }))
      // The first call finds the token expired on iiko's side
      .on('/api/2/menu', () =>
        iiko.callsTo('/api/2/menu').length === 1
          ? { status: 401, body: {} }
          : { body: { ok: true } },
      );
    const client = new IikoApiClient();
    await expect(client.call(cred, '/api/2/menu', {})).resolves.toEqual({
      ok: true,
    });
    expect(iiko.callsTo('/api/v2/access_token')).toHaveLength(2);
    const [first, second] = iiko.callsTo('/api/2/menu');
    expect(second.authorization).not.toBe(first.authorization);
  });

  it.each([
    [401, 'pos_key_invalid'],
    [400, 'pos_key_invalid'],
    [403, 'pos_access_denied'],
    [500, 'pos_unavailable'],
  ])('a token refused with %s is %s', async (status, code) => {
    iiko.on('/api/v2/access_token', {
      status,
      body: { errorDescription: `bad key ${KEY}`, correlationId: 'c' },
    });
    const e = await new IikoApiClient()
      .call(cred, '/api/2/menu', {})
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(IikoApiError);
    expect((e as IikoApiError).code).toBe(code);
    // Neither the key nor iiko's text reaches the error or the log line
    expect(iikoErrorText(e)).not.toContain(KEY);
    expect(toAppException(e)).toBeInstanceOf(AppException);
    expect(toAppException(e).code).toBe(code);
  });

  it.each([
    [
      401,
      {
        error: 'Unauthorized',
        errorDescription: 'Invalid appId or clientSecret',
      },
    ],
    [400, { errorDescription: 'Application not found' }],
  ])(
    'a token refused with %s naming the application is a platform failure, not a venue key',
    async (status, body) => {
      iiko.on('/api/v2/access_token', { status, body });
      const e = await new IikoApiClient()
        .call(cred, '/api/2/menu', {})
        .catch((x: unknown) => x);
      expect(e).toBeInstanceOf(AppException);
      expect(e).toMatchObject({
        code: 'platform_misconfigured',
        details: { feature: 'pos' },
      });
      expect(iikoErrorText(e)).not.toContain(KEY);
    },
  );

  it.each([
    [402, 'pos_module_missing'],
    [403, 'pos_access_denied'],
    [423, 'pos_access_blocked'],
    [429, 'pos_unavailable'],
    [503, 'pos_unavailable'],
  ])('a call answered %s is %s', async (status, code) => {
    iiko
      .on('/api/v2/access_token', {
        body: { token: fakeIikoToken(hourFromNow()) },
      })
      .on('/api/1/deliveries/order_types', {
        status,
        body: { error: 'Code', errorDescription: 'x' },
      });
    const e = await new IikoApiClient()
      .call(cred, '/api/1/deliveries/order_types', {})
      .catch((x: unknown) => x);
    expect((e as IikoApiError).code).toBe(code);
  });

  it('no response at all is pos_unavailable', async () => {
    process.env.IIKO_API_BASE_URL = 'http://127.0.0.1:1';
    const e = await new IikoApiClient()
      .call(cred, '/api/2/menu', {})
      .catch((x: unknown) => x);
    expect((e as IikoApiError).code).toBe('pos_unavailable');
    expect((e as IikoApiError).status).toBeNull();
  });

  it('without the integrator application: platform_misconfigured (pos), no call', async () => {
    delete process.env.IIKO_CLIENT_SECRET;
    const e = await new IikoApiClient()
      .call(cred, '/api/2/menu', {})
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AppException);
    expect((e as AppException).code).toBe('platform_misconfigured');
    expect((e as AppException).details).toEqual({ feature: 'pos' });
    expect(iiko.calls).toHaveLength(0);
  });

  it('jwtExpiry reads exp, null for anything else', () => {
    expect(jwtExpiry(fakeIikoToken(100))).toBe(100_000);
    expect(jwtExpiry('not-a-jwt')).toBeNull();
  });
});

describe('IikoProvider', () => {
  let iiko: FakeIikoServer;
  let env: NodeJS.ProcessEnv;
  let provider: IikoProvider;

  beforeEach(async () => {
    env = { ...process.env };
    iiko = await new FakeIikoServer().start();
    process.env.IIKO_API_BASE_URL = iiko.url;
    process.env.IIKO_APP_ID = 'app-id';
    process.env.IIKO_CLIENT_SECRET = 'client-secret';
    iiko.on('/api/v2/access_token', {
      body: { token: fakeIikoToken(hourFromNow()) },
    });
    provider = new IikoProvider(new IikoApiClient());
  });

  afterEach(async () => {
    process.env = env;
    await iiko.stop();
  });

  it('address format: the four iiko formats are known, the rest is unknown', async () => {
    expect(iikoAddressFormat('City')).toBe('city');
    expect(iikoAddressFormat('Legacy')).toBe('legacy');
    expect(iikoAddressFormat('International')).toBe('international');
    expect(iikoAddressFormat('IntNoPostcode')).toBe('int_no_postcode');
    expect(iikoAddressFormat('Other')).toBe('unknown');
    iiko.on('/api/1/organizations', {
      body: {
        organizations: [{ id: 'o1', name: 'A', addressFormatType: 'Legacy' }],
      },
    });
    await expect(provider.addressFormat(cred, 'o1')).resolves.toBe('legacy');
    await expect(provider.addressFormat(cred, 'o2')).rejects.toMatchObject({
      code: 'pos_access_denied',
    });
  });

  it('checks: key rights, delivery module (402) and cash desks per branch', async () => {
    iiko
      .on('/api/1/organizations', {
        body: { organizations: [{ id: 'o1', addressFormatType: 'City' }] },
      })
      .on('/api/1/deliveries/order_types', { status: 402, body: {} })
      .on('/api/1/terminal_groups/is_alive', {
        body: {
          isAliveStatus: [
            { terminalGroupId: 'tg1', isAlive: true },
            { terminalGroupId: 'tg2', isAlive: false },
          ],
        },
      });
    expect(
      await provider.checks(cred, 'o1', [
        { branchId: 'b1', terminalGroupId: 'tg1' },
        { branchId: 'b2', terminalGroupId: 'tg2' },
      ]),
    ).toEqual([
      { key: 'key_access', status: 'ok' },
      { key: 'delivery_module', status: 'fail', code: 'pos_module_missing' },
      { key: 'terminal_alive', branchId: 'b1', status: 'ok' },
      { key: 'terminal_alive', branchId: 'b2', status: 'fail' },
    ]);
  });

  it('the menu: the chosen external menu must still exist', async () => {
    iiko
      .on('/api/2/menu', {
        body: { externalMenus: [{ id: 'm1', name: 'Сайт' }] },
      })
      .on('/api/menu/v3/by_id', {
        body: {
          itemsGroups: [
            {
              id: 'g',
              name: 'G',
              items: [
                { productId: 'p', name: 'P', sizePrices: [{ price: 5 }] },
              ],
            },
          ],
        },
      });
    const menu = await provider.fetchMenu(cred, 'o1', 'm1', 'pc1');
    expect(menu.items.map((i) => i.externalId)).toEqual(['p']);
    expect(iiko.callsTo('/api/menu/v3/by_id')[0].body).toEqual({
      externalMenuId: 'm1',
      organizationId: 'o1',
      priceCategoryId: 'pc1',
    });
    await expect(
      provider.fetchMenu(cred, 'o1', 'gone', null),
    ).rejects.toMatchObject({
      code: 'pos_external_menu_missing',
    });
  });

  it('stop lists by terminal group', async () => {
    iiko.on('/api/1/stop_lists', {
      body: {
        terminalGroupStopLists: [
          {
            organizationId: 'o1',
            items: [
              {
                terminalGroupId: 'tg1',
                items: [
                  { productId: 'p1', balance: 0 },
                  { productId: 'p2', sizeId: 's', balance: 2 },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(await provider.fetchStopLists(cred, 'o1', ['tg1'])).toEqual([
      {
        terminalGroupId: 'tg1',
        items: [
          { externalId: 'p1', sizeId: null, balance: 0 },
          { externalId: 'p2', sizeId: 's', balance: 2 },
        ],
      },
    ]);
    expect(iiko.callsTo('/api/1/stop_lists')[0].body).toEqual({
      organizationIds: ['o1'],
      terminalGroupsIds: ['tg1'],
      // Sizes are asked for: one stopped size must not stop the whole dish
      returnSize: true,
    });
  });

  it('the webhook is set with the authToken, the stop list, order status and order error filters', async () => {
    iiko.on('/api/1/webhooks/update_settings', {
      body: { correlationId: 'c' },
    });
    await provider.setWebhook(
      cred,
      'o1',
      'https://api.x/pos/iiko/i/webhook',
      'secret',
    );
    expect(iiko.callsTo('/api/1/webhooks/update_settings')[0].body).toEqual({
      organizationId: 'o1',
      webHooksUri: 'https://api.x/pos/iiko/i/webhook',
      authToken: 'secret',
      webHooksFilter: {
        deliveryOrderFilter: {
          orderStatuses: [
            'Unconfirmed',
            'WaitCooking',
            'ReadyForCooking',
            'CookingStarted',
            'CookingCompleted',
            'Waiting',
            'OnWay',
            'Delivered',
            'Closed',
            'Cancelled',
          ],
          errors: true,
        },
        stopListUpdateFilter: { updates: true },
      },
    });
  });
});
