jest.mock('src/infra/helper/tg-bot/otp-bot', () => ({
  sendApplicationToTelegram: jest.fn(),
}));
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp } from 'src/infra/testing/http-app.fake';
import { PrismaService } from '../_prisma/prisma.service';
import { ApplicationController } from './application.controller';
import { ApplicationService } from './application.service';

describe('POST /application (public landing form)', () => {
  let app: INestApplication;
  const create = jest.fn(async ({ data }) => ({ id: 'app-1', ...data }));

  beforeAll(async () => {
    app = await createHttpApp({
      controllers: [ApplicationController],
      providers: [
        ApplicationService,
        { provide: PrismaService, useValue: { application: { create } } },
      ],
    });
  });

  afterAll(() => app.close());
  beforeEach(() => create.mockClear());

  const post = (body: unknown) =>
    request(app.getHttpServer()).post('/application').send(body as object);

  it('creates the application and answers only the id', async () => {
    const res = await post({
      from: 'web',
      fullName: 'Aziz',
      phone: '+998901234567',
    }).expect(201);
    expect(res.body).toEqual({ id: 'app-1' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('an empty body is 400 naming `from`, not a 500, and writes nothing', async () => {
    const res = await post({}).expect(400);
    expect(res.body.code).toBe('validation_error');
    expect(res.body.errors).toEqual([
      expect.objectContaining({ field: 'from' }),
    ]);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown from', { from: 'mars' }, 'from'],
    ['name too long', { from: 'web', fullName: 'x'.repeat(121) }, 'fullName'],
    ['phone too long', { from: 'web', phone: '9'.repeat(33) }, 'phone'],
    ['plan too long', { from: 'web', plan: 'x'.repeat(65) }, 'plan'],
    [
      'description too long',
      { from: 'web', description: 'x'.repeat(2001) },
      'description',
    ],
    ['name not a string', { from: 'web', fullName: 42 }, 'fullName'],
    ['unknown field', { from: 'web', admin: true }, 'admin'],
  ])('%s → 400 on that field', async (_why, body, field) => {
    const res = await post(body).expect(400);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(
      field,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts text exactly at the limits', async () => {
    await post({
      from: 'admin',
      fullName: 'x'.repeat(120),
      phone: '9'.repeat(32),
      plan: 'x'.repeat(64),
      description: 'x'.repeat(2000),
    }).expect(201);
  });
});
