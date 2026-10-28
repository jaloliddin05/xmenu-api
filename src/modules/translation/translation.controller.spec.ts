import { BadGatewayException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FakeRedis } from 'src/infra/redis/redis.fake';
import { ErrorFilter } from 'src/infra/validators';
import { PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { RateLimitService } from '../auth/services/rate-limit.service';
import { TranslationController } from './translation.controller';
import { TranslationService } from './translation.service';

describe('TranslationController', () => {
  let app: INestApplication;
  let redis: FakeRedis;
  const translate = jest.fn();

  beforeEach(async () => {
    process.env.TRANSLATION_RATE_LIMIT = '3';
    translate.mockReset().mockResolvedValue({ ru: 'x' });
    redis = new FakeRedis();
    const mod = await Test.createTestingModule({
      controllers: [TranslationController],
      providers: [
        { provide: TranslationService, useValue: { translate } },
        { provide: RateLimitService, useValue: new RateLimitService(redis as never) },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalFilters(new ErrorFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true, transform: true }));
    // Stand-in for the global access-token guard: x-user header = authenticated owner.
    app.use((req, _res, next) => {
      if (req.headers['x-user']) req.user = { id: req.headers['x-user'] };
      next();
    });
    await app.init();
  });
  afterEach(async () => {
    delete process.env.TRANSLATION_RATE_LIMIT;
    await app.close();
  });

  const post = (user: string | null, body: unknown) => {
    const r = request(app.getHttpServer()).post('/translation');
    if (user) r.set('x-user', user);
    return r.send(body as object);
  };
  const ok = { text: 'Плов', promptName: 'dish' };

  it('is not marked public, so the global guard demands an owner token', () => {
    expect(Reflect.getMetadata(PUBLIC_KEY, TranslationController.prototype.create)).toBeUndefined();
  });

  it('refuses a request without an authenticated user and never calls the model', async () => {
    expect((await post(null, ok)).status).toBe(401);
    expect(translate).not.toHaveBeenCalled();
  });

  it('translates within the limit and returns 429 with retryAfter beyond it', async () => {
    for (let i = 0; i < 3; i++) expect((await post('u1', ok)).status).toBe(201);
    const res = await post('u1', ok);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('rate_limited');
    expect(res.body.retryAfter).toBeGreaterThan(0);
    expect(translate).toHaveBeenCalledTimes(3);
  });

  it('limits per user, not globally', async () => {
    for (let i = 0; i < 3; i++) await post('u1', ok);
    expect((await post('u2', ok)).status).toBe(201);
  });

  it('does not let invalid requests dodge or spend validation: oversize and wrong types are 400', async () => {
    expect((await post('u1', { ...ok, text: 'a'.repeat(2001) })).status).toBe(400);
    expect((await post('u1', { ...ok, promptName: 'p'.repeat(101) })).status).toBe(400);
    expect((await post('u1', { text: ['a'], promptName: 'dish' })).status).toBe(400);
    expect((await post('u1', { text: { a: 1 }, promptName: 'dish' })).status).toBe(400);
    expect((await post('u1', { ...ok, extra: 1 })).status).toBe(400);
    expect(translate).not.toHaveBeenCalled();
  });

  it('maps model failures to 502 without leaking the raw response', async () => {
    translate.mockRejectedValue(new BadGatewayException('Invalid translation response'));
    const res = await post('u1', ok);
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toMatch(/sk-|gpt/i);
  });
});
