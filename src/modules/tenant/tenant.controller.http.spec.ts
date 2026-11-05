import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp } from 'src/infra/testing/http-app.fake';
import { PrismaService } from '../_prisma/prisma.service';
import { FakeDomainDb } from '../tenant-domain/tenant-domain-prisma.fake';
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
    expect(res.body).toMatchObject({ code: 'tenant_not_found', status: 404 });
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

describe('GET /tenant/by-host/:host', () => {
  const savedPlatform = process.env.PLATFORM_DOMAIN;
  const MANT = ID;
  const OTHER = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
  const OFF = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
  let app: INestApplication;
  let db: FakeDomainDb;

  beforeAll(async () => {
    process.env.PLATFORM_DOMAIN = 'xmenu.uz';
    db = new FakeDomainDb([
      { id: MANT, slug: 'mant', name: 'Mant', is_active: true },
      { id: OTHER, slug: 'other-cafe', name: 'Other', is_active: true },
      { id: OFF, slug: 'closed-cafe', name: 'Closed', is_active: false },
    ]);
    db.seed(MANT, 'order.mant.uz', 'verified');
    db.seed(MANT, 'xn--80ajzcicfi.uz', 'verified', new Date('2026-11-02'));
    db.seed(MANT, 'pending.mant.uz');
    db.seed(OTHER, 'pending.mant.uz');
    db.seed(OFF, 'closed.uz', 'verified');
    app = await createHttpApp({
      controllers: [TenantController],
      providers: [
        TenantService,
        { provide: PrismaService, useValue: db.client },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
    if (savedPlatform === undefined) delete process.env.PLATFORM_DOMAIN;
    else process.env.PLATFORM_DOMAIN = savedPlatform;
  });

  const byHost = (host: string) =>
    request(app.getHttpServer()).get(
      `/tenant/by-host/${encodeURIComponent(host)}`,
    );
  const MANT_REF = {
    id: MANT,
    slug: 'mant',
    name: 'Mant',
    primaryDomain: 'order.mant.uz',
  };

  it('resolves a platform subdomain by slug, without a table row, publicly cacheable', async () => {
    const res = await byHost('mant.xmenu.uz').expect(200);
    expect(res.body).toEqual(MANT_REF);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const other = await byHost('other-cafe.xmenu.uz').expect(200);
    expect(other.body).toEqual({
      id: OTHER,
      slug: 'other-cafe',
      name: 'Other',
      primaryDomain: null,
    });
  });

  it('resolves a verified own domain', async () => {
    await expect(byHost('order.mant.uz').expect(200)).resolves.toMatchObject({
      body: MANT_REF,
    });
  });

  it.each([
    ['upper case', 'Order.MANT.uz'],
    ['a port', 'order.mant.uz:443'],
    ['a trailing dot', 'order.mant.uz.'],
    ['the platform host in upper case with a dev port', 'MANT.xmenu.uz:3000'],
    ['an IDN in Unicode', 'Ресторан.uz'],
    ['an IDN in punycode', 'xn--80ajzcicfi.uz'],
  ])('normalises %s', async (_why, host) => {
    expect((await byHost(host).expect(200)).body.id).toBe(MANT);
  });

  it.each([
    ['a pending domain', 'pending.mant.uz'],
    ['an unknown domain', 'unknown.uz'],
    ['a verified domain of an inactive venue', 'closed.uz'],
    ['the platform subdomain of an inactive venue', 'closed-cafe.xmenu.uz'],
    ['an unknown slug', 'nope-cafe.xmenu.uz'],
    ['a reserved platform name', 'api.xmenu.uz'],
    ['two labels under the platform', 'a.mant.xmenu.uz'],
    ['the platform domain itself', 'xmenu.uz'],
    ['an IP address', '127.0.0.1:3000'],
    ['not a host name', 'mant.xmenu.uz/admin'],
  ])('404s %s, not cached', async (_why, host) => {
    const res = await byHost(host).expect(404);
    expect(res.body).toMatchObject({ code: 'tenant_not_found', status: 404 });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('does not look a platform host up in the table, nor an own domain by slug', async () => {
    db.client.tenant_domain.findUnique.mockClear();
    db.client.organization.findUnique.mockClear();
    await byHost('mant.xmenu.uz').expect(200);
    expect(db.client.tenant_domain.findUnique).not.toHaveBeenCalled();
    await byHost('order.mant.uz').expect(200);
    expect(db.client.organization.findUnique).toHaveBeenCalledTimes(1);
  });

  it('resolves only own domains while PLATFORM_DOMAIN is unset', async () => {
    delete process.env.PLATFORM_DOMAIN;
    try {
      await byHost('mant.xmenu.uz').expect(404);
      await byHost('order.mant.uz').expect(200);
    } finally {
      process.env.PLATFORM_DOMAIN = 'xmenu.uz';
    }
  });
});
