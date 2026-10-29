import { FakeRedis } from 'src/infra/redis/redis.fake';
import { CustomerSessionService, sha256 } from './customer-session.service';

const CTX = { ip: '127.0.0.1', userAgent: 'jest' };

describe('CustomerSessionService.logout', () => {
  const rows = () => [
    { id: 's1', family_id: 'fam-1', organization_id: 'org-a', customer_id: 'c1', token_hash: sha256('t1'), revoked_at: null as Date | null },
    { id: 's2', family_id: 'fam-1', organization_id: 'org-a', customer_id: 'c1', token_hash: sha256('t1b'), revoked_at: null as Date | null },
    { id: 's3', family_id: 'fam-2', organization_id: 'org-a', customer_id: 'c1', token_hash: sha256('t2'), revoked_at: null as Date | null },
  ];
  let data: ReturnType<typeof rows>;
  let redis: FakeRedis;
  let events: { log: jest.Mock };
  let service: CustomerSessionService;

  beforeEach(() => {
    data = rows();
    redis = new FakeRedis();
    events = { log: jest.fn() };
    const prisma = {
      customer_session: {
        findUnique: async ({ where }: { where: { token_hash: Buffer } }) =>
          data.find((r) => r.token_hash.equals(where.token_hash)) ?? null,
        updateMany: async ({ where, data: patch }: { where: { family_id: string }; data: { revoked_at: Date } }) => {
          const hit = data.filter((r) => r.family_id === where.family_id && r.revoked_at === null);
          hit.forEach((r) => Object.assign(r, patch));
          return { count: hit.length };
        },
      },
    };
    service = new CustomerSessionService(prisma as any, {} as any, events as any, redis as any, {
      accessTtlSeconds: 900,
    } as any);
  });

  it('revokes the whole family and denies its access tokens at once', async () => {
    await service.logout('t1', 'org-a', CTX);
    expect(data.filter((r) => r.family_id === 'fam-1').every((r) => r.revoked_at)).toBe(true);
    expect(data.find((r) => r.id === 's3')?.revoked_at).toBeNull();
    await expect(service.isSidDenied('fam-1')).resolves.toBe(true);
    await expect(service.isSidDenied('fam-2')).resolves.toBe(false);
  });

  it('ignores a token of another tenant, an unknown token and a missing one', async () => {
    await service.logout('t1', 'org-b', CTX);
    await service.logout('unknown', 'org-a', CTX);
    await service.logout(undefined, 'org-a', CTX);
    expect(data.every((r) => r.revoked_at === null)).toBe(true);
    expect(events.log).not.toHaveBeenCalled();
  });
});
