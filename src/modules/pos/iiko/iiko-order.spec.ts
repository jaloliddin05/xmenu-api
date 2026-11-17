import { IikoApiClient, IikoApiError } from './iiko-api.client';
import { IikoProvider } from './iiko.provider';
import { FakeIikoServer, fakeIikoToken } from './iiko-server.fake';

const cred = { integrationId: 'int-1', apiKey: 'restaurant-secret-key' };
const hourFromNow = () => Math.floor(Date.now() / 1000) + 3600;

const draft = {
  id: 'order-1',
  externalNumber: '12',
  terminalGroupId: 'tg1',
  kind: 'delivery' as const,
  phone: '+998901234567',
  customerName: 'Aziz',
  comment: 'no onion',
  items: [
    {
      productId: 'p1',
      sizeId: 's1',
      amount: 2,
      price: 30_000,
      modifiers: [{ productId: 'm1', groupId: 'g1', amount: 1, price: 5_000 }],
    },
  ],
  payment: {
    paymentTypeId: 'pt-cash',
    paymentTypeKind: 'Cash',
    sum: 70_000,
    processedExternally: false,
  },
  address: {
    format: 'city' as const,
    line: 'Tashkent, Amir Temur 1',
    latitude: 41.3,
    longitude: 69.2,
    entrance: '2',
    floor: '3',
    flat: '15',
    comment: 'gate code 12',
  },
};

describe('IikoProvider: orders', () => {
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

  it('creates a delivery: our order id, the cash desk timeout, the stop list check, only the guest data needed', async () => {
    iiko.on('/api/1/deliveries/create', {
      body: {
        correlationId: 'cid-1',
        orderInfo: { id: 'order-1', creationStatus: 'InProgress' },
      },
    });
    const res = await provider.createOrder(cred, 'o1', draft);
    expect(res).toEqual({
      correlationId: 'cid-1',
      info: {
        id: 'order-1',
        creation: 'in_progress',
        errorCode: null,
        status: null,
        number: null,
        courierName: null,
      },
    });
    expect(iiko.callsTo('/api/1/deliveries/create')[0].body).toEqual({
      organizationId: 'o1',
      terminalGroupId: 'tg1',
      createOrderSettings: { transportToFrontTimeout: 8, checkStopList: true },
      order: {
        id: 'order-1',
        externalNumber: '12',
        phone: '+998901234567',
        orderServiceType: 'DeliveryByCourier',
        customer: { type: 'one-time', name: 'Aziz' },
        comment: 'no onion',
        deliveryPoint: {
          coordinates: { latitude: 41.3, longitude: 69.2 },
          address: {
            type: 'city',
            line1: 'Tashkent, Amir Temur 1',
            entrance: '2',
            floor: '3',
            flat: '15',
          },
          comment: 'gate code 12',
        },
        items: [
          {
            type: 'Product',
            productId: 'p1',
            productSizeId: 's1',
            amount: 2,
            price: 30_000,
            modifiers: [
              {
                productId: 'm1',
                productGroupId: 'g1',
                amount: 1,
                price: 5_000,
              },
            ],
          },
        ],
        payments: [
          {
            paymentTypeKind: 'Cash',
            paymentTypeId: 'pt-cash',
            sum: 70_000,
            isProcessedExternally: false,
          },
        ],
      },
    });
  });

  it('pickup: DeliveryByClient without a delivery point; a legacy address names the iiko street', async () => {
    iiko.on('/api/1/deliveries/create', { body: { correlationId: 'c' } });
    await provider.createOrder(cred, 'o1', {
      ...draft,
      kind: 'pickup',
      address: null,
    });
    await provider.createOrder(cred, 'o1', {
      ...draft,
      address: {
        ...draft.address,
        format: 'legacy',
        streetId: 'st-1',
        house: '12A',
      },
    });
    const [pickup, legacy] = iiko
      .callsTo('/api/1/deliveries/create')
      .map((c) => c.body.order);
    expect(pickup.orderServiceType).toBe('DeliveryByClient');
    expect(pickup.deliveryPoint).toBeNull();
    expect(legacy.deliveryPoint.address).toEqual({
      type: 'legacy',
      street: { id: 'st-1' },
      house: '12A',
      entrance: '2',
      floor: '3',
      flat: '15',
    });
  });

  it('a create answer without a command id is a failed call', async () => {
    iiko.on('/api/1/deliveries/create', { body: {} });
    const e = await provider
      .createOrder(cred, 'o1', draft)
      .catch((x: unknown) => x);
    expect((e as IikoApiError).code).toBe('pos_unavailable');
  });

  it.each([
    [{ status: 200, body: { state: 'InProgress' } }, { state: 'in_progress' }],
    [{ status: 200, body: { state: 'Success' } }, { state: 'success' }],
    [
      {
        status: 200,
        body: { state: 'Error', exception: { code: 'StopListedProduct' } },
      },
      { state: 'error', errorCode: 'StopListedProduct' },
    ],
    [{ status: 410, body: {} }, { state: 'unknown' }],
  ])('commands/status %j → %j', async (reply, expected) => {
    iiko.on('/api/1/commands/status', reply);
    expect(await provider.commandStatus(cred, 'o1', 'cid')).toEqual(expected);
    expect(iiko.callsTo('/api/1/commands/status')[0].body).toEqual({
      organizationId: 'o1',
      correlationId: 'cid',
    });
  });

  it('commands/status: another failure is thrown with its code', async () => {
    iiko.on('/api/1/commands/status', { status: 503, body: {} });
    const e = await provider
      .commandStatus(cred, 'o1', 'cid')
      .catch((x: unknown) => x);
    expect((e as IikoApiError).code).toBe('pos_unavailable');
  });

  it('confirm and the delivery status are commands on our order id', async () => {
    iiko
      .on('/api/1/deliveries/confirm', { body: { correlationId: 'c1' } })
      .on('/api/1/deliveries/update_order_delivery_status', {
        body: { correlationId: 'c2' },
      });
    expect(await provider.confirmOrder(cred, 'o1', 'order-1')).toBe('c1');
    expect(
      await provider.setDeliveryStatus(cred, 'o1', 'order-1', 'OnWay'),
    ).toBe('c2');
    expect(iiko.callsTo('/api/1/deliveries/confirm')[0].body).toEqual({
      organizationId: 'o1',
      orderId: 'order-1',
    });
    expect(
      iiko.callsTo('/api/1/deliveries/update_order_delivery_status')[0].body,
    ).toEqual({
      organizationId: 'o1',
      orderId: 'order-1',
      deliveryStatus: 'OnWay',
    });
  });

  it('orders by id: status, number, courier and the creation error; unknown shapes skipped', async () => {
    iiko.on('/api/1/deliveries/by_id', {
      body: {
        orders: [
          {
            id: 'order-1',
            creationStatus: 'Success',
            order: {
              number: 1042,
              status: 'OnWay',
              courierInfo: { courier: { name: 'Bekzod' } },
            },
          },
          {
            id: 'order-2',
            creationStatus: 'Error',
            errorInfo: { code: 'TimeoutOnFront' },
          },
          { creationStatus: 'Success' },
        ],
      },
    });
    expect(await provider.orders(cred, 'o1', ['order-1', 'order-2'])).toEqual([
      {
        id: 'order-1',
        creation: 'success',
        errorCode: null,
        status: 'OnWay',
        number: '1042',
        courierName: 'Bekzod',
      },
      {
        id: 'order-2',
        creation: 'error',
        errorCode: 'TimeoutOnFront',
        status: null,
        number: null,
        courierName: null,
      },
    ]);
    expect(await provider.orders(cred, 'o1', [])).toEqual([]);
    expect(iiko.callsTo('/api/1/deliveries/by_id')).toHaveLength(1);
  });

  it('streets: by name across the cities of the organization, deleted ones left out', async () => {
    iiko
      .on('/api/1/cities', {
        body: {
          cities: [
            {
              organizationId: 'o1',
              items: [
                { id: 'c1', name: 'Tashkent' },
                { id: 'c2', name: 'Old', isDeleted: true },
              ],
            },
          ],
        },
      })
      .on('/api/1/streets/by_city', {
        body: {
          streets: [
            { id: 's1', name: 'Amir Temur' },
            { id: 's2', name: 'Navoi' },
            { id: 's3', name: 'Temur kichik', isDeleted: true },
          ],
        },
      });
    expect(await provider.streets(cred, 'o1', 'temur')).toEqual([
      { id: 's1', name: 'Amir Temur', city: 'Tashkent' },
    ]);
    expect(iiko.callsTo('/api/1/streets/by_city')).toHaveLength(1);
    expect(iiko.callsTo('/api/1/streets/by_city')[0].body).toEqual({
      organizationId: 'o1',
      cityId: 'c1',
    });
  });

  it('the webhook carries the order of DeliveryOrderUpdate and DeliveryOrderError', () => {
    const [update, error, stop] = provider.parseWebhook([
      {
        eventType: 'DeliveryOrderUpdate',
        organizationId: 'o1',
        eventInfo: {
          id: 'order-1',
          creationStatus: 'Success',
          order: { status: 'CookingCompleted', number: 7 },
        },
      },
      {
        eventType: 'DeliveryOrderError',
        organizationId: 'o1',
        eventInfo: {
          id: 'order-2',
          creationStatus: 'Error',
          errorInfo: { code: 'PriceMismatch' },
        },
      },
      {
        eventType: 'StopListUpdate',
        organizationId: 'o1',
        eventInfo: { terminalGroupsStopListsUpdates: [] },
      },
    ]);
    expect(update.order).toMatchObject({
      id: 'order-1',
      creation: 'success',
      status: 'CookingCompleted',
      number: '7',
    });
    expect(error.order).toMatchObject({
      id: 'order-2',
      creation: 'error',
      errorCode: 'PriceMismatch',
    });
    expect(stop.order).toBeNull();
  });
});
