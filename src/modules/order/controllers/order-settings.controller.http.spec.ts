import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { createHttpApp, staffToken } from 'src/infra/testing/http-app.fake';
import { PLATFORM_ORDER_SETTINGS } from 'src/modules/organization/domain/platform-defaults';
import { PaymentConfigService } from 'src/modules/payment/services/payment-config.service';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';
import { OrderSettingsService } from '../services/order-settings.service';
import { OrderSettingsController } from './order-settings.controller';

const ORG = '11111111-1111-4111-8111-111111111111';

describe('GET/PUT /order-settings: payment methods at delivery (W13-05)', () => {
  let app: INestApplication;
  let row: Record<string, unknown>;
  let providers: string[];
  const owner = `Bearer ${staffToken('owner')}`;

  beforeAll(async () => {
    const prisma = {
      organization_order_settings: {
        findUnique: jest.fn(async () => ({ ...row })),
        update: jest.fn(async ({ data }) => {
          for (const [k, v] of Object.entries(data))
            if (v !== undefined) row[k] = v;
          return row;
        }),
      },
    };
    app = await createHttpApp(
      {
        controllers: [OrderSettingsController],
        providers: [
          OrderSettingsService,
          { provide: PrismaService, useValue: prisma },
          {
            provide: PaymentConfigService,
            useValue: { enabledProviders: async () => new Set(providers) },
          },
          {
            provide: RevalidateService,
            useValue: { addRevalidationJob: jest.fn(async () => undefined) },
          },
        ],
      },
      [{ id: 'owner', role: 'owner', organization: { id: ORG } }],
    );
  });
  afterAll(() => app.close());

  beforeEach(() => {
    row = { organization_id: ORG, ...PLATFORM_ORDER_SETTINGS };
    providers = [];
    app.get(OrderSettingsService).invalidate(ORG);
  });

  const put = (body: object) =>
    request(app.getHttpServer())
      .put('/order-settings')
      .set('Authorization', owner)
      .send(body);

  it('a new venue takes cash only', async () => {
    const res = await request(app.getHttpServer())
      .get('/order-settings')
      .set('Authorization', owner)
      .expect(200);
    expect(res.body.deliveryPayment).toEqual({
      cash: true,
      card: false,
      online: false,
    });
  });

  it('switches cash and a card to the courier', async () => {
    const res = await put({
      deliveryPayment: { cash: false, card: true, online: false },
    }).expect(200);
    expect(res.body.deliveryPayment).toEqual({
      cash: false,
      card: true,
      online: false,
    });
    expect(row).toMatchObject({
      delivery_pay_cash: false,
      delivery_pay_card: true,
    });
  });

  it('online without a connected provider: 400 invalid_settings with a field code, nothing saved', async () => {
    const res = await put({
      deliveryPayment: { cash: true, card: false, online: true },
    }).expect(400);
    expect(res.body).toMatchObject({
      code: 'invalid_settings',
      fields: [
        {
          field: 'deliveryPayment.online',
          code: 'online_payment_not_connected',
        },
      ],
    });
    expect(row.delivery_pay_online).toBe(false);

    providers = ['click'];
    await put({
      deliveryPayment: { cash: true, card: false, online: true },
    }).expect(200);
    expect(row.delivery_pay_online).toBe(true);
  });

  it('every method off: 400 delivery_payment_required', async () => {
    const res = await put({
      deliveryPayment: { cash: false, card: false, online: false },
    }).expect(400);
    expect(res.body.fields).toEqual([
      expect.objectContaining({
        field: 'deliveryPayment',
        code: 'delivery_payment_required',
      }),
    ]);
  });

  it('a partial or non-boolean switch is a validation error', async () => {
    const res = await put({ deliveryPayment: { cash: true } }).expect(400);
    expect(res.body.code).toBe('validation_error');
  });
});
