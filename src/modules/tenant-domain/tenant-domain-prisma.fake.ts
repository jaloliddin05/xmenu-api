import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

export interface FakeOrg {
  id: string;
  slug: string | null;
  name: string;
  is_active: boolean;
}

export interface FakeDomain {
  id: string;
  organization_id: string;
  host: string;
  status: 'pending' | 'verified';
  verified_host: string | null;
  verification_token: string;
  verified_at: Date | null;
  last_check_at: Date | null;
  last_check_error: string | null;
  created_at: Date;
}

type Where = Record<string, any>;

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'fake',
  });

function matches(row: Record<string, any>, where: Where = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'organization_id_host')
      return row.organization_id === v.organization_id && row.host === v.host;
    return row[k] === v;
  });
}

function pick(row: Record<string, any>, select?: Record<string, any>) {
  if (!select) return { ...row };
  return Object.fromEntries(
    Object.keys(select)
      .filter((k) => select[k] === true)
      .map((k) => [k, row[k]]),
  );
}

/**
 * In-memory organization + tenant_domain with the database rules that matter here: unique
 * verified_host, unique (organization_id, host), cascade is not modelled. Supports the queries of
 * TenantDomainService, TenantService and PRIMARY_DOMAIN_SELECT.
 */
export class FakeDomainDb {
  orgs: FakeOrg[] = [];
  domains: FakeDomain[] = [];
  locks: string[] = [];

  constructor(orgs: FakeOrg[] = []) {
    this.orgs = orgs;
  }

  /** A row as TenantDomainService would leave it; `verified` fills verified_host. */
  seed(
    organizationId: string,
    host: string,
    status: 'pending' | 'verified' = 'pending',
    verifiedAt = new Date('2026-11-01T10:00:00Z'),
  ): FakeDomain {
    const row: FakeDomain = {
      id: randomUUID(),
      organization_id: organizationId,
      host,
      status,
      verified_host: status === 'verified' ? host : null,
      verification_token: `token-${host}-${organizationId.slice(0, 4)}`,
      verified_at: status === 'verified' ? verifiedAt : null,
      last_check_at: null,
      last_check_error: null,
      created_at: new Date(this.domains.length * 1000),
    };
    this.domains.push(row);
    return row;
  }

  private primaryOf(organizationId: string) {
    return this.domains
      .filter((d) => d.organization_id === organizationId)
      .filter((d) => d.status === 'verified')
      .sort(
        (a, b) =>
          a.verified_at!.getTime() - b.verified_at!.getTime() ||
          a.host.localeCompare(b.host),
      )
      .slice(0, 1)
      .map((d) => ({ host: d.host }));
  }

  private orgView(org: FakeOrg, select?: Record<string, any>) {
    const view: Record<string, any> = pick(org, select);
    if (select?.domains) view.domains = this.primaryOf(org.id);
    return view;
  }

  private checkUnique(next: FakeDomain, self?: FakeDomain) {
    for (const d of this.domains) {
      if (d === self) continue;
      if (next.verified_host && d.verified_host === next.verified_host)
        throw uniqueViolation();
      if (d.organization_id === next.organization_id && d.host === next.host)
        throw uniqueViolation();
    }
  }

  readonly client = {
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(this.client),
    ),
    $queryRaw: jest.fn(async (_sql: TemplateStringsArray, ...values: any[]) => {
      this.locks.push(String(values[0]));
      return [];
    }),
    organization: {
      findUnique: jest.fn(
        async ({ where, select }: { where: Where; select?: any }) => {
          const org = this.orgs.find((o) => matches(o, where));
          return org ? this.orgView(org, select) : null;
        },
      ),
    },
    tenant_domain: {
      findUnique: jest.fn(
        async ({ where, select }: { where: Where; select?: any }) => {
          const row = this.domains.find((d) => matches(d, where));
          if (!row) return null;
          if (select?.organization) {
            const org = this.orgs.find((o) => o.id === row.organization_id);
            return {
              ...pick(row, select),
              organization: org
                ? this.orgView(org, select.organization.select)
                : null,
            };
          }
          return pick(row, select);
        },
      ),
      findFirst: jest.fn(async ({ where }: { where: Where }) => {
        const row = this.domains.find((d) => matches(d, where));
        return row ? { ...row } : null;
      }),
      findMany: jest.fn(async ({ where }: { where: Where }) =>
        this.domains
          .filter((d) => matches(d, where))
          .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
          .map((d) => ({ ...d })),
      ),
      count: jest.fn(
        async ({ where }: { where: Where }) =>
          this.domains.filter((d) => matches(d, where)).length,
      ),
      create: jest.fn(async ({ data }: { data: Partial<FakeDomain> }) => {
        const row: FakeDomain = {
          id: randomUUID(),
          status: 'pending',
          verified_host: null,
          verified_at: null,
          last_check_at: null,
          last_check_error: null,
          created_at: new Date(),
          organization_id: data.organization_id!,
          host: data.host!,
          verification_token: data.verification_token!,
        };
        this.checkUnique(row);
        this.domains.push(row);
        return { ...row };
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: Where;
          data: Partial<FakeDomain>;
        }) => {
          const row = this.domains.find((d) => matches(d, where));
          if (!row) throw new Error('fake: record to update not found');
          Object.assign(row, data);
          return { ...row };
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: Where;
          data: Partial<FakeDomain>;
        }) => {
          const rows = this.domains.filter((d) => matches(d, where));
          for (const row of rows) {
            this.checkUnique({ ...row, ...data }, row);
            Object.assign(row, data);
          }
          return { count: rows.length };
        },
      ),
      deleteMany: jest.fn(async ({ where }: { where: Where }) => {
        const before = this.domains.length;
        this.domains = this.domains.filter((d) => !matches(d, where));
        return { count: before - this.domains.length };
      }),
    },
  };
}
