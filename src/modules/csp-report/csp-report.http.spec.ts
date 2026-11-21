import { INestApplication, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { PublicRateLimitGuard } from 'src/infra/http/public-rate-limit';
import { FakeRedis } from 'src/infra/redis/redis.fake';
import { createHttpApp } from 'src/infra/testing/http-app.fake';
import { RateLimitService } from 'src/modules/auth/services/rate-limit.service';
import { CspReportController } from './csp-report.controller';

const legacyBody = JSON.stringify({
  'csp-report': {
    'document-uri': 'https://mant.xmenu.uz/ru/cart?phone=998901234567',
    'blocked-uri': 'https://cdn.example.com/lib.js?k=1',
    'effective-directive': 'script-src-elem',
  },
});
const reportingBody = JSON.stringify([
  {
    type: 'csp-violation',
    body: {
      documentURL: 'https://dashboard.xmenu.uz/settings',
      blockedURL: 'https://yastatic.net/a.js',
      effectiveDirective: 'script-src-elem',
    },
  },
  {
    type: 'csp-violation',
    body: {
      documentURL: 'https://dashboard.xmenu.uz/settings',
      blockedURL: 'inline',
      effectiveDirective: 'style-src-attr',
    },
  },
]);

describe('POST /csp-report', () => {
  let app: INestApplication;
  let redis: FakeRedis;
  let log: jest.SpyInstance;

  beforeEach(async () => {
    redis = new FakeRedis();
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    app = await createHttpApp({
      controllers: [CspReportController],
      providers: [
        {
          provide: RateLimitService,
          useValue: new RateLimitService(redis as never),
        },
        { provide: APP_GUARD, useClass: PublicRateLimitGuard },
      ],
    });
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    // Nest logs its own start-up lines through the same Logger
    log.mockClear();
  });
  afterEach(async () => {
    log.mockRestore();
    await app.close();
  });

  const send = (body: string, type: string, ip = '10.0.0.1') =>
    request(app.getHttpServer())
      .post('/csp-report')
      .set('Content-Type', type)
      .set('X-Forwarded-For', ip)
      .send(body);

  const lines = () => log.mock.calls.map((c) => String(c[0]));

  it('accepts the legacy format without a token: 204, one line with hosts only', async () => {
    await send(legacyBody, 'application/csp-report').expect(204);
    expect(lines()).toEqual([
      'csp_report directive=script-src-elem blocked=cdn.example.com document=mant.xmenu.uz',
    ]);
    expect(lines().join()).not.toMatch(/998901234567|k=1|\/ru\/cart/);
  });

  it('accepts a Reporting API batch: one line per violation', async () => {
    await send(reportingBody, 'application/reports+json').expect(204);
    expect(lines()).toEqual([
      'csp_report directive=script-src-elem blocked=yastatic.net document=dashboard.xmenu.uz',
      'csp_report directive=style-src-attr blocked=inline document=dashboard.xmenu.uz',
    ]);
  });

  it('accepts application/json with either body', async () => {
    await send(legacyBody, 'application/json').expect(204);
    await send(reportingBody, 'application/json; charset=utf-8').expect(204);
    expect(lines()).toHaveLength(3);
  });

  it('a broken body is 204 and is not logged, not even as an error', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    try {
      await send('{"csp-report": {', 'application/csp-report').expect(204);
      await send('{"csp-report": {', 'application/json').expect(204);
      await send('[{"type":"other"}]', 'application/reports+json').expect(204);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('a body over 16 KB is 413 payload_too_large', async () => {
    const big = JSON.stringify({
      'csp-report': { pad: 'x'.repeat(17 * 1024) },
    });
    const res = await send(big, 'application/csp-report').expect(413);
    expect(res.body.code).toBe('payload_too_large');
    expect(log).not.toHaveBeenCalled();
  });

  it('another Content-Type is 415 unsupported_media_type', async () => {
    const res = await send(legacyBody, 'text/plain').expect(415);
    expect(res.body.code).toBe('unsupported_media_type');
  });

  it('has its own limit of 60 a minute per IP', async () => {
    for (let i = 0; i < 60; i++)
      await send(legacyBody, 'application/csp-report').expect(204);
    const res = await send(legacyBody, 'application/csp-report').expect(429);
    expect(res.body.code).toBe('rate_limited');
    expect(res.headers['retry-after']).toBe(String(res.body.retryAfter));
    await send(legacyBody, 'application/csp-report', '10.0.0.2').expect(204);
    redis.advance(61);
    await send(legacyBody, 'application/csp-report').expect(204);
  });
});
