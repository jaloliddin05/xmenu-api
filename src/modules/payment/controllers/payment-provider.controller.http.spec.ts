import { randomBytes } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp, staffToken } from 'src/infra/testing/http-app.fake';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { PLATFORM_ORDER_SETTINGS } from 'src/modules/organization/domain/platform-defaults';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';
import { PaymentConfigService } from '../services/payment-config.service';
import { PaymentProviderController } from './payment-provider.controller';

const ORG = '11111111-1111-4111-8111-111111111111';
const CLICK = {
  merchantId: 'm',
  serviceId: 's',
  merchantUserId: 'u',
  secretKey: 'k',
};

describe('Payment providers: the last payment method at delivery stays (W13F-04)', () => {
  let app: INestApplication;
  let settings: Record<string, unknown>;
  let providers: Map<string, boolean>;
  const queryRaw = jest.fn(async (..._args: unknown[]) => []);
  const addRevalidationJob = jest.fn(async () => undefined);
  const owner = `Bearer ${staffToken('owner')}`;

  beforeAll(async () => {
    process.env.PAYMENT_CONFIG_KEY = randomBytes(32).toString('base64');
    const prisma = {
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
      ),
      $queryRaw: queryRaw,
      organization_order_settings: {
        findUnique: jest.fn(async () => ({ ...settings })),
      },
      organization_payment_provider: {
        findMany: jest.fn(async ({ where }) =>
          [...providers]
            .filter(([, on]) => where.is_enabled === undefined || on)
            .map(([provider, on]) => ({ provider, is_enabled: on })),
        ),
        upsert: jest.fn(async ({ where, create }) => {
          providers.set(
            where.organization_id_provider.provider,
            create.is_enabled,
          );
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          if (providers.has(where.provider))
            providers.set(where.provider, data.is_enabled);
          return { count: 1 };
        }),
      },
    };
    app = await createHttpApp(
      {
        controllers: [PaymentProviderController],
        providers: [
          PaymentConfigService,
          { provide: PrismaService, useValue: prisma },
          { provide: RevalidateService, useValue: { addRevalidationJob } },
        ],
      },
      [{ id: 'owner', role: 'owner', organization: { id: ORG } }],
    );
  });
  afterAll(() => app.close());

  beforeEach(() => {
    settings = {
      organization_id: ORG,
      ...PLATFORM_ORDER_SETTINGS,
      delivery_pay_cash: false,
      delivery_pay_card: false,
      delivery_pay_online: true,
    };
    providers = new Map([['click', true]]);
    jest.clearAllMocks();
  });

  const disable = (provider: string) =>
    request(app.getHttpServer())
      .post(`/payment-provider/${provider}/disable`)
      .set('Authorization', owner);
  const upsert = (provider: string, body: object) =>
    request(app.getHttpServer())
      .put(`/payment-provider/${provider}`)
      .set('Authorization', owner)
      .send(body);

  it('online is the only method: disabling its provider is 409, the provider stays on, nothing is revalidated', async () => {
    const res = await disable('click').expect(409);
    expect(res.body.code).toBe('delivery_payment_last_method');
    expect(providers.get('click')).toBe(true);
    expect(addRevalidationJob).not.toHaveBeenCalled();
    // read under the venue row lock
    expect(queryRaw.mock.calls[0][0]).toEqual(
      expect.arrayContaining([expect.stringContaining('FOR UPDATE')]),
    );
  });

  it('PUT with isEnabled: false is refused the same way', async () => {
    const res = await upsert('click', {
      config: CLICK,
      isEnabled: false,
    }).expect(409);
    expect(res.body.code).toBe('delivery_payment_last_method');
    expect(providers.get('click')).toBe(true);
  });

  it('only external services deliver and cash is on: online is still the last method', async () => {
    settings.courier_mode = 'external';
    settings.delivery_pay_cash = true;
    await disable('click').expect(409);
  });

  it('cash on with own couriers: the provider is disabled', async () => {
    settings.delivery_pay_cash = true;
    await disable('click').expect(204);
    expect(providers.get('click')).toBe(false);
    expect(addRevalidationJob).toHaveBeenCalled();
  });

  it('another provider stays: disabled', async () => {
    providers.set('payme', true);
    await disable('click').expect(204);
    expect(providers.get('click')).toBe(false);
  });

  it('enabling a provider is never refused', async () => {
    providers = new Map();
    await upsert('payme', {
      config: { merchantId: 'm', key: 'k' },
      isEnabled: true,
    }).expect(200);
    expect(providers.get('payme')).toBe(true);
  });
});
