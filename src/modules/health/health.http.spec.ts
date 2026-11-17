import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp } from 'src/infra/testing/http-app.fake';
import { REDIS } from 'src/infra/redis/redis.module';
import { PrismaService } from '../_prisma/prisma.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('GET /health, GET /health/ready', () => {
  let app: INestApplication;
  const prisma = { $queryRaw: jest.fn() };
  const redis = { ping: jest.fn() };

  beforeAll(async () => {
    app = await createHttpApp({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS, useValue: redis },
      ],
    });
  });
  afterAll(() => app.close());
  beforeEach(() => {
    prisma.$queryRaw.mockReset().mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockReset().mockResolvedValue('PONG');
  });

  const get = (path: string) => request(app.getHttpServer()).get(path);

  it('liveness answers without a token and without touching the database or Redis', async () => {
    const res = await get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('readiness: 200 when both answer', async () => {
    const res = await get('/health/ready').expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('readiness: 503 naming the dependency that is down, without the error text', async () => {
    prisma.$queryRaw.mockRejectedValue(
      new Error('connect ECONNREFUSED 10.0.0.2:5432'),
    );
    const res = await get('/health/ready').expect(503);
    expect(res.body).toEqual({
      status: 'unavailable',
      checks: { database: 'down', redis: 'up' },
    });
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  it('readiness: a dependency that hangs counts as down after the timeout', async () => {
    redis.ping.mockReturnValue(new Promise(() => undefined));
    const report = await app.get(HealthService).readiness(20);
    expect(report).toEqual({
      status: 'unavailable',
      checks: { database: 'up', redis: 'down' },
    });
  });
});
