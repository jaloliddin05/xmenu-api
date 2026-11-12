import {
  Body,
  Controller,
  Get,
  INestApplication,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsString } from 'class-validator';
import request from 'supertest';
import { Public } from 'src/modules/auth/decorators/public.decorator';
import { createHttpApp } from '../testing/http-app.fake';
import { AppException, platformMisconfigured } from './app-exception';
import { describeError } from './app-error-filter';

const LEAK =
  'connect ECONNREFUSED at /app/src/modules/x/y.ts:10:5 DATABASE_URL=postgresql://u:secret@db';

class NameDto {
  @IsString() name: string;
}

@Public()
@Controller('t')
class ThrowingController {
  @Get('app')
  app() {
    throw new AppException('branch_closed', {
      message: 'Branch is closed',
      details: { opensAt: '09:00', internalNote: 'x' },
    });
  }

  @Get('limited')
  limited() {
    throw new AppException('rate_limited', { retryAfter: 42 });
  }

  @Get('misconfigured')
  misconfigured() {
    throw platformMisconfigured('sms', 'ESKIZ_PASSWORD is not set');
  }

  @Get('phone')
  phone() {
    throw new AppException('not_found', { cause: 'duplicate +998901234567' });
  }

  @Get('crash')
  crash() {
    throw new Error(LEAK);
  }

  @Get('prisma')
  prisma() {
    throw new Prisma.PrismaClientKnownRequestError(LEAK, {
      code: 'P2002',
      clientVersion: '6',
    });
  }

  @Get('framework')
  framework() {
    throw new NotFoundException(LEAK);
  }

  @Get('uuid/:id')
  uuid(@Param('id', ParseUUIDPipe) id: string) {
    return id;
  }

  @Post('body')
  body(@Body() dto: NameDto) {
    return dto;
  }
}

/** Staff route: needs an owner token (global AccessTokenUserGuard). */
@Controller('staff')
class StaffController {
  @Get()
  get() {
    return 'never';
  }
}

describe('AppErrorFilter (HTTP)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const error = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  const warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);

  beforeAll(async () => {
    app = await createHttpApp({
      controllers: [ThrowingController, StaffController],
    });
  });
  afterAll(() => app.close());
  beforeEach(() => {
    error.mockClear();
    warn.mockClear();
  });

  const SHAPE = ['code', 'message', 'requestId', 'status'];

  it('AppException: code, message, status, allowed details, the same requestId in header and body', async () => {
    const res = await http().get('/t/app').expect(409);
    expect(res.body).toEqual({
      code: 'branch_closed',
      message: 'Branch is closed',
      status: 409,
      details: { opensAt: '09:00' },
      requestId: res.headers['x-request-id'],
    });
    expect(res.headers['cache-control']).toBe('no-store');
    // the dropped detail key is reported for developers, never sent
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('details dropped: internalNote'),
    );
  });

  it('4xx without a cause still leaves one warn line: requestId, method, route pattern, status, code', async () => {
    const id = '0a0a0a0a-0000-4000-8000-000000000001';
    const res = await http()
      .get(`/t/uuid/${id}-bad`)
      .set('X-Request-Id', 'support-code-0001')
      .expect(400);
    expect(res.body.requestId).toBe('support-code-0001');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[support-code-0001] GET /t/uuid/:id 400 bad_request',
    );
  });

  it('the log line has no request body and masks phone numbers', async () => {
    await http()
      .post('/t/body')
      .send({ name: 42, secret: 'hunter2' })
      .expect(400);
    await http().get('/t/phone').expect(404);
    const lines = warn.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(lines).not.toContain('hunter2');
    expect(lines).toContain('+998*******67');
    expect(lines).not.toContain('998901234567');
  });

  it('unknown path: 404 logged with a fixed marker, never the raw path (it may carry tokens)', async () => {
    await http()
      .get(
        '/no-such-route/eyJhbGciOiJIUzI1NiJ9.secret-token?phone=998901234567',
      )
      .set('X-Request-Id', 'support-code-0002')
      .expect(404);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[support-code-0002] GET <unmatched route> 404 not_found',
    );
  });

  it('keeps a well-formed X-Request-Id from the proxy and replaces a bad one', async () => {
    const kept = await http()
      .get('/t/app')
      .set('X-Request-Id', 'nginx-req-12345678');
    expect(kept.headers['x-request-id']).toBe('nginx-req-12345678');
    expect(kept.body.requestId).toBe('nginx-req-12345678');
    const replaced = await http()
      .get('/t/app')
      .set('X-Request-Id', 'bad id with spaces');
    expect(replaced.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('429: retryAfter in the body and Retry-After header', async () => {
    const res = await http().get('/t/limited').expect(429);
    expect(res.body).toMatchObject({ code: 'rate_limited', retryAfter: 42 });
    expect(res.headers['retry-after']).toBe('42');
  });

  it('platform_misconfigured: details.feature only, the cause goes to the log with the requestId', async () => {
    const res = await http().get('/t/misconfigured').expect(503);
    expect(res.body).toEqual({
      code: 'platform_misconfigured',
      message: 'This feature is not configured on the platform',
      status: 503,
      details: { feature: 'sms' },
      requestId: res.headers['x-request-id'],
    });
    expect(JSON.stringify(res.body)).not.toContain('ESKIZ');
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`${res.body.requestId}.*ESKIZ_PASSWORD is not set`),
      ),
      undefined,
    );
  });

  it.each([
    ['an Error', '/t/crash'],
    ['a Prisma error', '/t/prisma'],
  ])(
    '%s: 500 internal_error without details; text and stack in the log',
    async (_what, path) => {
      const res = await http().get(path).expect(500);
      expect(res.body).toEqual({
        code: 'internal_error',
        message: 'Internal server error',
        status: 500,
        requestId: res.headers['x-request-id'],
      });
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining(res.body.requestId),
        expect.stringContaining('at '),
      );
      expect(error.mock.calls[0][0]).toContain('ECONNREFUSED');
    },
  );

  it('framework exceptions keep the status but never their text', async () => {
    const res = await http().get('/t/framework').expect(404);
    expect(res.body).toMatchObject({ code: 'not_found', message: 'Not found' });
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
    const route = await http().get('/no/such/route').expect(404);
    expect(route.body).toMatchObject({ code: 'not_found', status: 404 });
    const uuid = await http().get('/t/uuid/nope').expect(400);
    expect(uuid.body).toMatchObject({ code: 'bad_request', status: 400 });
    expect(uuid.body.message).toBe('Bad request');
  });

  it('validation: 400 validation_error with a code per field', async () => {
    const res = await http()
      .post('/t/body')
      .send({ name: 1, extra: true })
      .expect(400);
    expect(res.body.code).toBe('validation_error');
    expect(res.body.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'name', code: 'is_string' }),
        expect.objectContaining({ field: 'extra', code: 'unknown_field' }),
      ]),
    );
  });

  it('broken JSON: 400 invalid_body without the parser text', async () => {
    const res = await http()
      .post('/t/body')
      .set('Content-Type', 'application/json')
      .send('{"name": ')
      .expect(400);
    expect(res.body).toMatchObject({ code: 'invalid_body', status: 400 });
    expect(res.body.message).toBe('Request body is not valid JSON');
  });

  it('owner and public routes answer with the same shape', async () => {
    const staff = await http().get('/staff').expect(401);
    const pub = await http().get('/t/framework').expect(404);
    expect(Object.keys(staff.body).sort()).toEqual(SHAPE);
    expect(Object.keys(pub.body).sort()).toEqual(SHAPE);
    expect(staff.body.code).toBe('unauthorized');
  });
});

describe('describeError', () => {
  it('never puts an exception text into the body', () => {
    for (const e of [
      new Error(LEAK),
      new NotFoundException(LEAK),
      'a thrown string ' + LEAK,
      { message: LEAK },
    ]) {
      const { body } = describeError(e);
      expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    }
  });

  it('logs every error: warn for 4xx, error for 5xx', () => {
    expect(describeError(new AppException('not_found')).log).toEqual({
      level: 'warn',
      text: 'not_found',
    });
    expect(describeError(new NotFoundException()).log.level).toBe('warn');
    expect(describeError(new Error('x')).log.level).toBe('error');
    expect(
      describeError(new AppException('not_found', { cause: 'gone' })).log,
    ).toMatchObject({ level: 'warn', text: 'not_found; cause: gone' });
  });

  it('a body-parser "too large" error is 413 payload_too_large', () => {
    const e = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
    });
    expect(describeError(e).body).toMatchObject({
      code: 'payload_too_large',
      status: 413,
    });
  });
});
