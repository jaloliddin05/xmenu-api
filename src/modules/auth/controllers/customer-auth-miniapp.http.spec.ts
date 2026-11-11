import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp } from 'src/infra/testing/http-app.fake';
import { PrismaService } from '../../_prisma/prisma.service';
import { GuestLoginService } from '../../guest-login/guest-login.service';
import { TenantService } from '../../tenant/tenant.service';
import { CustomerAuthService } from '../services/customer-auth.service';
import { INIT_DATA_CASES, miniAppAccess } from '../services/init-data.fake';
import { MiniAppAccessService } from '../services/mini-app-access.service';
import { TelegramVerificationService } from '../services/telegram-verification.service';
import { AuthCustomerController } from './customer-auth.controller';

const ORG = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const PHONE = '+998901234567';

/** The delivery mode on the guest sign-in steps (docs/TELEGRAM_VERIFICATION.md, "Mini App и режимы доставки"). */
describe('guest sign-in under the delivery mode', () => {
  let app: INestApplication;
  let mode: 'site' | 'miniapp' | 'both';
  const auth = {
    requestOtp: jest.fn(async () => ({ resendAfter: 60, codeLength: 6 })),
    verifyOtp: jest.fn(async () => ({
      isNewUser: true,
      registrationToken: 'r',
    })),
    register: jest.fn(async () => ({ accessToken: 'a', refreshToken: 'r' })),
    telegramLogin: jest.fn(async () => ({
      isNewUser: true,
      requiresPhone: true,
    })),
  };
  const verification = {
    start: jest.fn(async () => ({ sessionId: 's', mode: 'instant' })),
  };

  beforeAll(async () => {
    const prisma = {
      organization: {
        findUnique: jest.fn(async () => ({
          id: ORG,
          slug: 'cafe',
          name: 'Cafe',
          is_active: true,
          settings: {
            default_language: 'ru',
            languages: ['ru'],
            currency: 'UZS',
          },
        })),
      },
    };
    app = await createHttpApp({
      controllers: [AuthCustomerController],
      providers: [
        TenantService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomerAuthService, useValue: auth },
        { provide: TelegramVerificationService, useValue: verification },
        { provide: GuestLoginService, useValue: {} },
        {
          provide: MiniAppAccessService,
          useValue: miniAppAccess({ mode: () => mode, hasBot: () => true }),
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const post = (path: string, body: object, initData?: string) => {
    const req = request(app.getHttpServer())
      .post(`/auth/customer/${path}`)
      .set('X-Tenant-Id', ORG);
    if (initData) req.set('X-Telegram-Init-Data', initData);
    return req.send(body);
  };

  const STEPS: [string, object][] = [
    ['otp/request', { phone: PHONE }],
    ['otp/verify', { phone: PHONE, code: '123456' }],
    ['register', { registrationToken: 'r', name: 'Aziz' }],
    ['telegram/start', { phone: PHONE }],
  ];

  it.each(STEPS)(
    'miniapp: %s without the header is 403 miniapp_required',
    async (path, body) => {
      mode = 'miniapp';
      const res = await post(path, body).expect(403);
      expect(res.body.code).toBe('miniapp_required');
    },
  );

  it.each(STEPS)(
    'miniapp: %s with initData of another bot is 403 miniapp_init_data_invalid',
    async (path, body) => {
      mode = 'miniapp';
      const res = await post(path, body, INIT_DATA_CASES.foreignBot()).expect(
        403,
      );
      expect(res.body.code).toBe('miniapp_init_data_invalid');
    },
  );

  it.each(STEPS)(
    'miniapp: %s with valid initData goes on',
    async (path, body) => {
      mode = 'miniapp';
      await post(path, body, INIT_DATA_CASES.valid()).expect(200);
    },
  );

  it.each(STEPS)(
    'site: %s ignores even an expired header',
    async (path, body) => {
      mode = 'site';
      await post(path, body, INIT_DATA_CASES.expired()).expect(200);
    },
  );

  it.each(STEPS)(
    'both: %s without the header goes on, with a forged one is 403',
    async (path, body) => {
      mode = 'both';
      await post(path, body).expect(200);
      const res = await post(path, body, INIT_DATA_CASES.forged()).expect(403);
      expect(res.body.code).toBe('miniapp_init_data_invalid');
    },
  );

  it('miniapp: the header alone starts the instant mode of telegram/start', async () => {
    mode = 'miniapp';
    const initData = INIT_DATA_CASES.valid();
    await post('telegram/start', {}, initData).expect(200);
    expect(verification.start).toHaveBeenCalledWith(
      expect.anything(),
      { initData },
      expect.anything(),
    );
  });

  it('a checked header links the Telegram user on otp/verify and register', async () => {
    mode = 'both';
    const initData = INIT_DATA_CASES.valid();
    await post('otp/verify', { phone: PHONE, code: '123456' }, initData).expect(
      200,
    );
    expect(auth.verifyOtp.mock.calls[0][1]).toMatchObject({ initData });
    await post(
      'register',
      { registrationToken: 'r', name: 'Aziz' },
      initData,
    ).expect(200);
    expect(auth.register.mock.calls[0][1]).toMatchObject({ initData });
  });

  it('login: initData in the body passes the miniapp check, a stale one does not', async () => {
    mode = 'miniapp';
    await post('login', { initData: INIT_DATA_CASES.valid() }).expect(200);
    const res = await post('login', {
      initData: INIT_DATA_CASES.expired(),
    }).expect(403);
    expect(res.body.code).toBe('miniapp_init_data_invalid');
    expect(auth.telegramLogin).toHaveBeenCalledTimes(1);
  });
});
