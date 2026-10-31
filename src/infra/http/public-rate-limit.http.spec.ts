jest.mock('src/infra/helper/tg-bot/otp-bot', () => ({
  sendApplicationToTelegram: jest.fn(),
}));
import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { FakeRedis } from 'src/infra/redis/redis.fake';
import { createHttpApp, staffToken } from 'src/infra/testing/http-app.fake';
import { ApplicationController } from 'src/modules/application-form/application.controller';
import { ApplicationService } from 'src/modules/application-form/application.service';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { Public } from 'src/modules/auth/decorators/public.decorator';
import { RateLimitService } from 'src/modules/auth/services/rate-limit.service';
import {
  PublicRateLimitGuard,
  publicPostRate,
  SkipPublicRateLimit,
} from './public-rate-limit';

@Controller('t')
class ProbeController {
  @Public()
  @Post('open')
  open() {
    return { ok: true };
  }

  @Public()
  @Get('read')
  read() {
    return { ok: true };
  }

  @Public()
  @SkipPublicRateLimit()
  @Post('hook')
  hook() {
    return { ok: true };
  }

  // No @Public(): the staff guard answers first; the limiter ignores it
  @Post('private')
  secret() {
    return { ok: true };
  }
}

describe('PublicRateLimitGuard', () => {
  let app: INestApplication;
  let redis: FakeRedis;
  const create = jest.fn(async ({ data }) => ({ id: 'app-1', ...data }));
  const saved = { ...process.env };

  beforeEach(async () => {
    process.env.PUBLIC_POST_RATE_LIMIT = '3';
    process.env.PUBLIC_POST_RATE_WINDOW_SECONDS = '60';
    process.env.APPLICATION_RATE_LIMIT = '2';
    redis = new FakeRedis();
    create.mockClear();
    app = await createHttpApp(
      {
        controllers: [ProbeController, ApplicationController],
        providers: [
          ApplicationService,
          { provide: PrismaService, useValue: { application: { create } } },
          {
            provide: RateLimitService,
            useValue: new RateLimitService(redis as never),
          },
          { provide: APP_GUARD, useClass: PublicRateLimitGuard },
        ],
      },
      [{ id: 'owner', organization: { id: 'org' } }],
    );
    app.getHttpAdapter().getInstance().set('trust proxy', true);
  });
  afterEach(async () => {
    process.env = { ...saved };
    await app.close();
  });

  const post = (path: string, ip = '10.0.0.1', body: object = {}) =>
    request(app.getHttpServer())
      .post(path)
      .set('X-Forwarded-For', ip)
      .send(body);

  it('reads its limits from the env, with defaults', () => {
    expect(publicPostRate({})).toEqual({ limit: 120, ttlSeconds: 60 });
    expect(publicPostRate({ PUBLIC_POST_RATE_LIMIT: '7' } as never).limit).toBe(
      7,
    );
    expect(publicPostRate({ PUBLIC_POST_RATE_LIMIT: 'x' } as never).limit).toBe(
      120,
    );
  });

  it('answers 429 rate_limited with Retry-After after the limit, per IP', async () => {
    for (let i = 0; i < 3; i++) await post('/t/open').expect(201);
    const res = await post('/t/open').expect(429);
    expect(res.body.code).toBe('rate_limited');
    expect(res.body.retryAfter).toBeGreaterThan(0);
    expect(res.headers['retry-after']).toBe(String(res.body.retryAfter));

    await post('/t/open', '10.0.0.2').expect(201);
  });

  it('the window passes: requests are accepted again', async () => {
    for (let i = 0; i < 3; i++) await post('/t/open').expect(201);
    await post('/t/open').expect(429);
    redis.advance(61);
    await post('/t/open').expect(201);
  });

  it('does not count GET, exempt webhook routes or routes that are not public', async () => {
    for (let i = 0; i < 6; i++) {
      await request(app.getHttpServer())
        .get('/t/read')
        .set('X-Forwarded-For', '10.0.0.1')
        .expect(200);
      await post('/t/hook').expect(201);
    }
    // not public → the staff guard answers 401, and the counter is untouched
    await post('/t/private').expect(401);
    await post('/t/private')
      .set('Authorization', `Bearer ${staffToken('owner')}`)
      .expect(201);
    for (let i = 0; i < 3; i++) await post('/t/open').expect(201);
  });

  describe('POST /application', () => {
    const valid = { from: 'web', fullName: 'Aziz' };

    it('has its own stricter limit, 429 after APPLICATION_RATE_LIMIT', async () => {
      await post('/application', '10.0.0.1', valid).expect(201);
      await post('/application', '10.0.0.1', valid).expect(201);
      const res = await post('/application', '10.0.0.1', valid).expect(429);
      expect(res.body.code).toBe('rate_limited');
      expect(create).toHaveBeenCalledTimes(2);
      // another IP, and the general limit of other routes, are untouched
      await post('/application', '10.0.0.2', valid).expect(201);
    });

    it('also counts in the general limit: invalid bodies still spend requests', async () => {
      await post('/application', '10.0.0.3', {}).expect(400);
      await post('/application', '10.0.0.3', {}).expect(400);
      await post('/application', '10.0.0.3', {}).expect(429);
    });
  });
});
