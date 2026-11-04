import { PrismaService } from '../_prisma/prisma.service';
import { RevalidateService } from '../revalidate-queue/revalidate.service';
import { TenantService } from '../tenant/tenant.service';
import { FakeDomainVerifier } from './domain-verifier.fake';
import { FakeDomainDb } from './tenant-domain-prisma.fake';
import {
  TENANT_DOMAIN_LIMIT,
  TenantDomainService,
} from './tenant-domain.service';

const ORG_A = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const ORG_B = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';

async function rejection(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    const err = e as { getStatus(): number; getResponse(): any };
    return { status: err.getStatus(), body: err.getResponse() };
  }
  throw new Error('expected a rejection');
}

describe('TenantDomainService', () => {
  const savedPlatform = process.env.PLATFORM_DOMAIN;
  let db: FakeDomainDb;
  let verifier: FakeDomainVerifier;
  let revalidate: { addRevalidationJob: jest.Mock };
  let tenants: { invalidate: jest.Mock };
  let service: TenantDomainService;

  const build = (instant = false) => {
    verifier = new FakeDomainVerifier(instant);
    service = new TenantDomainService(
      db.client as unknown as PrismaService,
      tenants as unknown as TenantService,
      revalidate as unknown as RevalidateService,
      verifier,
    );
  };

  beforeEach(() => {
    process.env.PLATFORM_DOMAIN = 'xmenu.uz';
    db = new FakeDomainDb([
      { id: ORG_A, slug: 'mant', name: 'Mant', is_active: true },
      { id: ORG_B, slug: 'other-cafe', name: 'Other', is_active: true },
    ]);
    revalidate = { addRevalidationJob: jest.fn(async () => undefined) };
    tenants = { invalidate: jest.fn() };
    build();
  });

  afterAll(() => {
    if (savedPlatform === undefined) delete process.env.PLATFORM_DOMAIN;
    else process.env.PLATFORM_DOMAIN = savedPlatform;
  });

  describe('add', () => {
    it('stores the canonical host as pending with its own TXT record, under the venue lock', async () => {
      const view = await service.add(ORG_A, ' Ресторан.UZ. ');
      expect(view).toMatchObject({
        host: 'xn--80ajzcicfi.uz',
        hostUnicode: 'ресторан.uz',
        status: 'pending',
        isPrimary: false,
        verifiedAt: null,
        verification: {
          type: 'TXT',
          name: '_xmenu-verify.xn--80ajzcicfi.uz',
        },
      });
      expect(view.verification.value).toMatch(/^xmenu-verify=[\w-]{32}$/);
      expect(db.locks).toEqual([ORG_A]);
      expect(verifier.calls).toEqual([]);
      // Pending resolves to nobody: nothing public changed
      expect(revalidate.addRevalidationJob).not.toHaveBeenCalled();
    });

    it.each([
      ['https://restaurant.uz', 'invalid_host'],
      ['restaurant.uz:8080', 'invalid_host'],
      ['mant.xmenu.uz', 'platform_host'],
      ['API.XMENU.UZ', 'platform_host'],
      ['localhost', 'reserved_host'],
      ['10.0.0.1', 'reserved_host'],
    ])('refuses %s with %s on the host field', async (host, code) => {
      const { status, body } = await rejection(service.add(ORG_A, host));
      expect(status).toBe(400);
      expect(body).toMatchObject({
        code,
        errors: [{ field: 'host', reason: code }],
      });
      expect(db.client.$transaction).not.toHaveBeenCalled();
    });

    it('409s the same host added again by the same venue, in any case', async () => {
      await service.add(ORG_A, 'restaurant.uz');
      const { status, body } = await rejection(
        service.add(ORG_A, 'RESTAURANT.uz'),
      );
      expect(status).toBe(409);
      expect(body.code).toBe('domain_already_added');
    });

    it('409s a host another venue has verified', async () => {
      db.seed(ORG_B, 'restaurant.uz', 'verified');
      const { status, body } = await rejection(
        service.add(ORG_A, 'restaurant.uz'),
      );
      expect(status).toBe(409);
      expect(body.code).toBe('domain_taken');
    });

    it('lets a venue claim a host that is only pending at another venue, with a different token', async () => {
      const theirs = db.seed(ORG_B, 'restaurant.uz');
      const mine = await service.add(ORG_A, 'restaurant.uz');
      expect(mine.status).toBe('pending');
      expect(mine.verification.value).not.toBe(
        `xmenu-verify=${theirs.verification_token}`,
      );
    });

    it(`allows ${TENANT_DOMAIN_LIMIT} domains, pending ones included, and refuses one more`, async () => {
      db.seed(ORG_A, 'a.restaurant.uz', 'verified');
      for (let i = 1; i < TENANT_DOMAIN_LIMIT; i++)
        await service.add(ORG_A, `d${i}.restaurant.uz`);
      const { status, body } = await rejection(
        service.add(ORG_A, 'one-more.uz'),
      );
      expect(status).toBe(422);
      expect(body).toMatchObject({
        code: 'domain_limit_reached',
        details: { limit: TENANT_DOMAIN_LIMIT },
      });
      // Another venue's domains do not count
      await expect(service.add(ORG_B, 'one-more.uz')).resolves.toBeDefined();
    });

    it('verifies at once when the verifier says so (DOMAIN_VERIFY_SKIP)', async () => {
      build(true);
      verifier.next = { ok: true };
      const view = await service.add(ORG_A, 'abc-123.trycloudflare.com');
      expect(view).toMatchObject({ status: 'verified', isPrimary: true });
      expect(revalidate.addRevalidationJob).toHaveBeenCalledWith({
        tenantId: ORG_A,
        route: 'domains',
        host: 'abc-123.trycloudflare.com',
      });
    });
  });

  describe('verify', () => {
    it('verifies with the TXT check, becomes primary, invalidates and revalidates', async () => {
      const added = await service.add(ORG_A, 'restaurant.uz');
      verifier.next = { ok: true };
      const view = await service.verify(ORG_A, added.id);
      expect(view).toMatchObject({
        status: 'verified',
        isPrimary: true,
        lastCheckError: null,
      });
      expect(view.verifiedAt).toBeInstanceOf(Date);
      const token = db.domains[0].verification_token;
      expect(verifier.calls).toEqual([{ host: 'restaurant.uz', token }]);
      expect(db.domains[0].verified_host).toBe('restaurant.uz');
      expect(tenants.invalidate).toHaveBeenCalledWith(ORG_A);
      expect(revalidate.addRevalidationJob).toHaveBeenCalledWith({
        tenantId: ORG_A,
        route: 'domains',
        host: 'restaurant.uz',
      });
    });

    it.each(['record_not_found', 'token_mismatch', 'dns_error'] as const)(
      '422s %s, records it and stays pending',
      async (reason) => {
        const added = await service.add(ORG_A, 'restaurant.uz');
        verifier.next = { ok: false, reason };
        const { status, body } = await rejection(
          service.verify(ORG_A, added.id),
        );
        expect(status).toBe(422);
        expect(body).toMatchObject({
          code: 'domain_verification_failed',
          details: {
            reason,
            record: { type: 'TXT', name: '_xmenu-verify.restaurant.uz' },
          },
        });
        expect(db.domains[0]).toMatchObject({
          status: 'pending',
          verified_host: null,
          last_check_error: reason,
        });
        expect(db.domains[0].last_check_at).toBeInstanceOf(Date);
        expect(revalidate.addRevalidationJob).not.toHaveBeenCalled();
      },
    );

    it('409s when another venue verified the same host first', async () => {
      const added = await service.add(ORG_A, 'restaurant.uz');
      db.seed(ORG_B, 'restaurant.uz', 'verified');
      verifier.next = { ok: true };
      const { status, body } = await rejection(service.verify(ORG_A, added.id));
      expect(status).toBe(409);
      expect(body.code).toBe('domain_taken');
      expect(db.domains[0]).toMatchObject({
        status: 'pending',
        last_check_error: 'domain_taken',
      });
    });

    it('answers a verified domain as is, without a check', async () => {
      const row = db.seed(ORG_A, 'restaurant.uz', 'verified');
      await expect(service.verify(ORG_A, row.id)).resolves.toMatchObject({
        status: 'verified',
      });
      expect(verifier.calls).toEqual([]);
      expect(revalidate.addRevalidationJob).not.toHaveBeenCalled();
    });

    it("404s another venue's domain and an unknown id", async () => {
      const theirs = db.seed(ORG_B, 'restaurant.uz');
      for (const id of [theirs.id, 'nope']) {
        const { status, body } = await rejection(service.verify(ORG_A, id));
        expect(status).toBe(404);
        expect(body.code).toBe('domain_not_found');
      }
      expect(verifier.calls).toEqual([]);
    });
  });

  describe('remove', () => {
    it('removes a verified domain and revalidates its host', async () => {
      const row = db.seed(ORG_A, 'restaurant.uz', 'verified');
      await service.remove(ORG_A, row.id);
      expect(db.domains).toEqual([]);
      expect(tenants.invalidate).toHaveBeenCalledWith(ORG_A);
      expect(revalidate.addRevalidationJob).toHaveBeenCalledWith({
        tenantId: ORG_A,
        route: 'domains',
        host: 'restaurant.uz',
      });
    });

    it('removes a pending domain without revalidation', async () => {
      const row = db.seed(ORG_A, 'restaurant.uz');
      await service.remove(ORG_A, row.id);
      expect(db.domains).toEqual([]);
      expect(revalidate.addRevalidationJob).not.toHaveBeenCalled();
    });

    it("404s another venue's domain and keeps it", async () => {
      const theirs = db.seed(ORG_B, 'restaurant.uz', 'verified');
      const { status } = await rejection(service.remove(ORG_A, theirs.id));
      expect(status).toBe(404);
      expect(db.domains).toHaveLength(1);
    });
  });

  describe('list', () => {
    it('shows the platform address, the earliest verified domain as primary and every row', async () => {
      db.seed(ORG_A, 'late.uz', 'verified', new Date('2026-11-03T00:00:00Z'));
      db.seed(ORG_A, 'early.uz', 'verified', new Date('2026-11-02T00:00:00Z'));
      db.seed(ORG_A, 'pending.uz');
      db.seed(ORG_B, 'theirs.uz', 'verified', new Date('2026-01-01T00:00:00Z'));
      const list = await service.list(ORG_A);
      expect(list).toMatchObject({
        platformHost: 'mant.xmenu.uz',
        primaryDomain: 'early.uz',
        limit: TENANT_DOMAIN_LIMIT,
      });
      expect(list.items.map((i) => [i.host, i.status, i.isPrimary])).toEqual([
        ['late.uz', 'verified', false],
        ['early.uz', 'verified', true],
        ['pending.uz', 'pending', false],
      ]);
    });

    it('has no platform address without PLATFORM_DOMAIN', async () => {
      delete process.env.PLATFORM_DOMAIN;
      await expect(service.list(ORG_A)).resolves.toMatchObject({
        platformHost: null,
        primaryDomain: null,
        items: [],
      });
    });
  });
});
