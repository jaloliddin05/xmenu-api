import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp } from 'src/infra/testing/http-app.fake';
import { PrismaService } from '../_prisma/prisma.service';
import { FakeDomainDb } from '../tenant-domain/tenant-domain-prisma.fake';
import { InternalTlsController } from './internal-tls.controller';
import { TenantService } from './tenant.service';

const MANT = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const OFF = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';

// supertest connects from 127.0.0.1: a direct call inside the server, as Caddy's `ask` makes it
describe('GET /internal/tls/allow', () => {
  const savedPlatform = process.env.PLATFORM_DOMAIN;
  let app: INestApplication;

  beforeAll(async () => {
    process.env.PLATFORM_DOMAIN = 'xmenu.uz';
    const db = new FakeDomainDb([
      { id: MANT, slug: 'mant', name: 'Mant', is_active: true },
      { id: OFF, slug: 'closed-cafe', name: 'Closed', is_active: false },
    ]);
    db.seed(MANT, 'order.mant.uz', 'verified');
    db.seed(MANT, 'pending.mant.uz');
    db.seed(OFF, 'closed.uz', 'verified');
    app = await createHttpApp({
      controllers: [InternalTlsController],
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

  const ask = (domain?: string) =>
    request(app.getHttpServer())
      .get('/internal/tls/allow')
      .query(domain === undefined ? {} : { domain });

  it.each([
    ['the platform subdomain of an active venue', 'mant.xmenu.uz'],
    ['a verified own domain of an active venue', 'order.mant.uz'],
    ['an own domain in upper case', 'Order.Mant.uz'],
  ])('200 without a body for %s', async (_why, domain) => {
    const res = await ask(domain).expect(200);
    expect(res.text).toBe('');
    expect(res.headers['content-length']).toBe('0');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['an unknown platform subdomain', 'nobody.xmenu.uz'],
    ['an inactive venue', 'closed-cafe.xmenu.uz'],
    ['a verified domain of an inactive venue', 'closed.uz'],
    ['a pending own domain', 'pending.mant.uz'],
    ['an unknown domain', 'unknown.uz'],
    ['a reserved platform subdomain', 'api.xmenu.uz'],
    ['the platform domain itself', 'xmenu.uz'],
    ['two labels under the platform domain', 'a.mant.xmenu.uz'],
    ['an IP address', '203.0.113.7'],
    ['not a host name', 'mant.xmenu.uz/x'],
    ['an empty value', ''],
  ])('404 without a body for %s', async (_why, domain) => {
    const res = await ask(domain).expect(404);
    expect(res.text).toBe('');
  });

  it('404 without the domain parameter, or with it twice', async () => {
    await ask().expect(404);
    const res = await request(app.getHttpServer())
      .get('/internal/tls/allow?domain=mant.xmenu.uz&domain=order.mant.uz')
      .expect(404);
    expect(res.text).toBe('');
  });

  it.each([
    ['X-Forwarded-For', '203.0.113.7'],
    ['X-Forwarded-Host', 'api.xmenu.uz'],
    ['X-Forwarded-Proto', 'https'],
    ['Forwarded', 'for=203.0.113.7'],
  ])(
    'the same empty 404 for a known host through the public proxy (%s)',
    async (header, value) => {
      const res = await ask('mant.xmenu.uz').set(header, value).expect(404);
      expect(res.text).toBe('');
    },
  );
});
