import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp } from 'src/infra/testing/http-app.fake';
import { PrismaService } from '../_prisma/prisma.service';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

const ID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';

describe('GET /tenant/by-slug/:slug', () => {
  let app: INestApplication;
  let findUnique: jest.Mock;

  beforeAll(async () => {
    const orgs = [
      { id: ID, slug: 'cafe-example', is_active: true },
      { id: 'off-id', slug: 'closed-cafe', is_active: false },
    ];
    findUnique = jest.fn(
      async ({ where }) => orgs.find((o) => o.slug === where.slug) ?? null,
    );
    app = await createHttpApp({
      controllers: [TenantController],
      providers: [
        TenantService,
        { provide: PrismaService, useValue: { organization: { findUnique } } },
      ],
    });
  });

  afterAll(() => app.close());
  beforeEach(() => findUnique.mockClear());

  it('returns only id and slug, publicly cacheable, without a token', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenant/by-slug/cafe-example')
      .expect(200);
    expect(res.body).toEqual({ id: ID, slug: 'cafe-example' });
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it.each([
    ['unknown slug', 'nope-cafe'],
    ['inactive venue', 'closed-cafe'],
  ])('404s an %s, not cached', async (_why, slug) => {
    const res = await request(app.getHttpServer())
      .get(`/tenant/by-slug/${slug}`)
      .expect(404);
    expect(res.body).toEqual({
      error: { code: 'tenant_not_found', message: 'tenant_not_found' },
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['an id in place of the slug', ID],
    ['an invalid slug', 'Cafe_Example'],
  ])('404s %s without a lookup', async (_why, slug) => {
    await request(app.getHttpServer())
      .get(`/tenant/by-slug/${slug}`)
      .expect(404);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
