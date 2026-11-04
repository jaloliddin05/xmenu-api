import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp, staffToken } from 'src/infra/testing/http-app.fake';
import { PrismaService } from '../_prisma/prisma.service';
import { RevalidateService } from '../revalidate-queue/revalidate.service';
import { TenantService } from '../tenant/tenant.service';
import { DOMAIN_VERIFIER } from './domain-verifier';
import { FakeDomainVerifier } from './domain-verifier.fake';
import { FakeDomainDb } from './tenant-domain-prisma.fake';
import { TenantDomainController } from './tenant-domain.controller';
import { TenantDomainService } from './tenant-domain.service';

const ORG_A = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const ORG_B = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const USER_A = 'user-a';

describe('/organization/:id/domains (owner)', () => {
  const savedPlatform = process.env.PLATFORM_DOMAIN;
  let app: INestApplication;
  let db: FakeDomainDb;
  const verifier = new FakeDomainVerifier();
  const revalidate = { addRevalidationJob: jest.fn(async () => undefined) };
  const auth = () => ({ Authorization: `Bearer ${staffToken(USER_A)}` });

  beforeAll(async () => {
    process.env.PLATFORM_DOMAIN = 'xmenu.uz';
    db = new FakeDomainDb();
    app = await createHttpApp(
      {
        controllers: [TenantDomainController],
        providers: [
          TenantDomainService,
          { provide: PrismaService, useValue: db.client },
          { provide: TenantService, useValue: { invalidate: jest.fn() } },
          { provide: RevalidateService, useValue: revalidate },
          { provide: DOMAIN_VERIFIER, useValue: verifier },
        ],
      },
      [{ id: USER_A, organization: { id: ORG_A, slug: 'mant' } }],
    );
  });

  beforeEach(() => {
    db.orgs = [
      { id: ORG_A, slug: 'mant', name: 'Mant', is_active: true },
      { id: ORG_B, slug: 'other-cafe', name: 'Other', is_active: true },
    ];
    db.domains = [];
    verifier.next = { ok: false, reason: 'record_not_found' };
    revalidate.addRevalidationJob.mockClear();
  });

  afterAll(async () => {
    await app.close();
    if (savedPlatform === undefined) delete process.env.PLATFORM_DOMAIN;
    else process.env.PLATFORM_DOMAIN = savedPlatform;
  });

  it('adds, verifies, lists and removes a domain', async () => {
    const server = app.getHttpServer();
    const added = await request(server)
      .post(`/organization/${ORG_A}/domains`)
      .set(auth())
      .send({ host: 'Order.Restaurant.uz' })
      .expect(201);
    expect(added.body).toMatchObject({
      host: 'order.restaurant.uz',
      status: 'pending',
      verification: { type: 'TXT', name: '_xmenu-verify.order.restaurant.uz' },
    });

    const failed = await request(server)
      .post(`/organization/${ORG_A}/domains/${added.body.id}/verify`)
      .set(auth())
      .expect(422);
    expect(failed.body).toMatchObject({
      code: 'domain_verification_failed',
      details: { reason: 'record_not_found' },
    });

    verifier.next = { ok: true };
    const verified = await request(server)
      .post(`/organization/${ORG_A}/domains/${added.body.id}/verify`)
      .set(auth())
      .expect(200);
    expect(verified.body).toMatchObject({
      status: 'verified',
      isPrimary: true,
    });

    const list = await request(server)
      .get(`/organization/${ORG_A}/domains`)
      .set(auth())
      .expect(200);
    expect(list.body).toMatchObject({
      platformHost: 'mant.xmenu.uz',
      primaryDomain: 'order.restaurant.uz',
      limit: 5,
    });
    expect(list.body.items).toHaveLength(1);

    await request(server)
      .delete(`/organization/${ORG_A}/domains/${added.body.id}`)
      .set(auth())
      .expect(204);
    expect(db.domains).toEqual([]);
  });

  it('answers 400 with the host field for an invalid or platform host', async () => {
    const res = await request(app.getHttpServer())
      .post(`/organization/${ORG_A}/domains`)
      .set(auth())
      .send({ host: 'shop.xmenu.uz' })
      .expect(400);
    expect(res.body).toMatchObject({
      code: 'platform_host',
      errors: [{ field: 'host', reason: 'platform_host' }],
    });
    const missing = await request(app.getHttpServer())
      .post(`/organization/${ORG_A}/domains`)
      .set(auth())
      .send({})
      .expect(400);
    expect(missing.body.code).toBe('validation_error');
    expect(
      new Set(missing.body.errors.map((e: { field: string }) => e.field)),
    ).toEqual(new Set(['host']));
  });

  it("404s another venue's organization id on every route, touching nothing", async () => {
    const theirs = db.seed(ORG_B, 'theirs.uz', 'verified');
    const server = app.getHttpServer();
    const base = `/organization/${ORG_B}/domains`;
    await request(server).get(base).set(auth()).expect(404);
    await request(server)
      .post(base)
      .set(auth())
      .send({ host: 'x.uz' })
      .expect(404);
    await request(server)
      .post(`${base}/${theirs.id}/verify`)
      .set(auth())
      .expect(404);
    await request(server)
      .delete(`${base}/${theirs.id}`)
      .set(auth())
      .expect(404);
    expect(db.domains).toHaveLength(1);
  });

  it("404s another venue's domain id under the owner's organization", async () => {
    const theirs = db.seed(ORG_B, 'theirs.uz', 'verified');
    const res = await request(app.getHttpServer())
      .delete(`/organization/${ORG_A}/domains/${theirs.id}`)
      .set(auth())
      .expect(404);
    expect(res.body.code).toBe('domain_not_found');
    expect(db.domains).toHaveLength(1);
  });

  it('401s without a token', async () => {
    await request(app.getHttpServer())
      .get(`/organization/${ORG_A}/domains`)
      .expect(401);
  });
});
