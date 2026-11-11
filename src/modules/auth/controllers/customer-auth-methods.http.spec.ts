import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { REDIS } from 'src/infra/redis/redis.module';
import { createHttpApp } from 'src/infra/testing/http-app.fake';
import { PrismaService } from '../../_prisma/prisma.service';
import { GuestLoginService } from '../../guest-login/guest-login.service';
import { OpsNotifierService } from '../../order/notifications/ops-notifier.service';
import { TelegramBotService } from '../../telegram/telegram-bot.service';
import { TenantService } from '../../tenant/tenant.service';
import { CustomerAuthService } from '../services/customer-auth.service';
import { TelegramVerificationService } from '../services/telegram-verification.service';
import { MiniAppAccessService } from '../services/mini-app-access.service';
import { AuthCustomerController } from './customer-auth.controller';

const ORG = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';

describe('GET /auth/customer/methods', () => {
  let app: INestApplication;
  let botUsable: boolean;
  const OLD = { ...process.env };

  beforeAll(async () => {
    const prisma = {
      organization: {
        findUnique: jest.fn(async ({ where }) =>
          where.id === ORG
            ? {
                id: ORG,
                slug: 'cafe',
                name: 'Cafe',
                is_active: true,
                settings: {
                  default_language: 'ru',
                  languages: ['ru'],
                  currency: 'UZS',
                },
                delivery_enabled: true,
                published_at: new Date(),
              }
            : null,
        ),
      },
    };
    app = await createHttpApp({
      controllers: [AuthCustomerController],
      providers: [
        TenantService,
        GuestLoginService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomerAuthService, useValue: {} },
        { provide: TelegramVerificationService, useValue: {} },
        { provide: MiniAppAccessService, useValue: {} },
        {
          provide: TelegramBotService,
          useValue: { usable: async () => botUsable },
        },
        { provide: OpsNotifierService, useValue: { alert: jest.fn() } },
        { provide: REDIS, useValue: { set: jest.fn(async () => 'OK') } },
      ],
    });
  });

  afterAll(async () => {
    process.env = { ...OLD };
    await app.close();
  });

  const methods = () =>
    request(app.getHttpServer())
      .get('/auth/customer/methods')
      .set('X-Tenant-Id', ORG);

  it('answers the current methods, never cached', async () => {
    process.env.SMS_PROVIDER = 'console';
    botUsable = true;
    const res = await methods().expect(200);
    expect(res.body).toEqual({ sms: true, telegram: true });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('follows a change at once: no SMS on the platform, bot token unreadable', async () => {
    process.env.SMS_PROVIDER = 'eskiz';
    delete process.env.ESKIZ_EMAIL;
    delete process.env.OTP_DEV_MODE;
    botUsable = false;
    expect((await methods().expect(200)).body).toEqual({
      sms: false,
      telegram: false,
    });
  });

  it('400 tenant_required without X-Tenant-Id', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/customer/methods')
      .expect(400);
    expect(res.body.code).toBe('tenant_required');
  });
});
