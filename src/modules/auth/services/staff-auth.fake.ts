import type Redis from 'ioredis';
import { Prisma } from '@prisma/client';
import { FakeRedis } from 'src/infra/redis/redis.fake';
import type { SmsProvider } from 'src/modules/sms/providers/sms-provider.interface';
import { DEFAULT_OTP_RATE_LIMITS } from '../customer-auth.config';
import type { CustomerAuthConfig } from '../customer-auth.config';
import { CustomerOtpService } from './customer-otp.service';
import { RateLimitService } from './rate-limit.service';
import { StaffAuthEventService } from './staff-auth-event.service';
import { StaffLoginThrottleService } from './staff-login-throttle.service';

export const staffTestConfig = {
  otpHmacSecret: 'test-hmac-secret',
  otpLength: 6,
  otpTtlSeconds: 300,
  otpMaxAttempts: 5,
  otpCooldownSeconds: 60,
  otpRateLimits: DEFAULT_OTP_RATE_LIMITS,
  otpDevMode: false,
} as CustomerAuthConfig;

export class FakeSms implements SmsProvider {
  sent: { phone: string; text: string }[] = [];
  failNext = false;
  /** Pretend the provider takes this long, so a send that is not awaited shows in response time. */
  delayMs = 0;
  async send(phone: string, text: string) {
    if (this.delayMs)
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failNext) {
      this.failNext = false;
      throw new Error('provider down');
    }
    this.sent.push({ phone, text });
  }
  lastCode(): string {
    const m = this.sent[this.sent.length - 1]?.text.match(/\d{6}/);
    if (!m) throw new Error('no code sent');
    return m[0];
  }
}

export interface UserRow {
  id: string;
  phone: string;
  password: string | null;
  first_name: string | null;
  last_name: string | null;
  isActive: boolean;
}

export interface OrgRow {
  id: string;
  name: string;
  type: string;
  slug: string;
  is_active: boolean;
}

export interface MemberRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  role: 'owner' | 'operator';
  status: 'invited' | 'active' | 'disabled';
  phone: string;
  first_name: string;
  last_name: string | null;
  created_at?: Date;
  invite_expires_at?: Date | null;
  invited_by_id?: string | null;
  activated_at?: Date | null;
  disabled_at?: Date | null;
}

/** Prisma `where` on plain columns: equality, `{ gt }` and `{ not }`. */
function matches(row: object, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = (row as Record<string, unknown>)[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { gt?: Date; not?: unknown };
      if ('gt' in c) return value instanceof Date && value > c.gt!;
      if ('not' in c) return value !== c.not;
    }
    return value === cond;
  });
}

/**
 * In-memory stand-in for the slice of Prisma the staff auth code touches. `$transaction` runs the
 * callback on a copy and only keeps it if the callback succeeds, like a real rollback.
 */
export class FakeStaffPrisma {
  users: UserRow[] = [];
  orgs: OrgRow[] = [];
  members: MemberRow[] = [];
  events: { type: string; meta?: unknown; phone_masked: string | null }[] = [];
  private seq = 0;

  nextId(prefix: string) {
    return `${prefix}-${++this.seq}`;
  }

  /** The owner row of a venue's staff. */
  ownerOf(organizationId: string) {
    return this.members.find(
      (m) => m.organization_id === organizationId && m.role === 'owner',
    );
  }

  private withMembership(u: UserRow) {
    const m = this.members.find((x) => x.user_id === u.id);
    return {
      ...u,
      membership: m
        ? {
            ...m,
            organization: this.orgs.find((o) => o.id === m.organization_id)!,
          }
        : null,
    };
  }

  user = {
    findUnique: async ({ where, include, select }: any) => {
      const u = this.users.find((x) =>
        where.id ? x.id === where.id : x.phone === where.phone,
      );
      if (!u) return null;
      return include?.membership || select?.membership
        ? this.withMembership(u)
        : { ...u };
    },
    findUniqueOrThrow: async ({ where }: any) => {
      const u = this.users.find((x) => x.id === where.id);
      if (!u) throw new Error('not found');
      return this.withMembership(u);
    },
    create: async ({ data }: any) => {
      if (this.users.some((u) => u.phone === data.phone))
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'fake',
          meta: { target: ['phone'] },
        });
      const row: UserRow = {
        id: this.nextId('user'),
        password: null,
        first_name: null,
        last_name: null,
        isActive: false,
        ...data,
      };
      this.users.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const u = this.users.find((x) => x.id === where.id)!;
      Object.assign(u, data);
      return { ...u };
    },
  };

  organization_member = {
    findMany: async ({ where }: any) =>
      this.members.filter((m) => matches(m, where)).map((m) => ({ ...m })),
    findFirst: async ({ where }: any) => {
      const m = this.members.find((x) => matches(x, where));
      return m ? { ...m } : null;
    },
    findUnique: async ({ where }: any) => {
      const key = where.organization_id_phone ?? where;
      const m = this.members.find((x) => matches(x, key));
      return m ? { ...m } : null;
    },
    create: async ({ data }: any) => {
      const row: MemberRow = {
        id: this.nextId('member'),
        user_id: null,
        last_name: null,
        created_at: new Date(),
        invite_expires_at: null,
        invited_by_id: null,
        activated_at: null,
        disabled_at: null,
        ...data,
      };
      this.members.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const m = this.members.find((x) => x.id === where.id)!;
      Object.assign(m, data);
      return { ...m };
    },
    updateMany: async ({ where, data }: any) => {
      const rows = this.members.filter((m) => matches(m, where));
      rows.forEach((m) => Object.assign(m, data));
      return { count: rows.length };
    },
  };

  /** pg_advisory_xact_lock: the fake does not model locks. */
  async $executeRaw() {
    return 1;
  }

  organization = {
    update: async ({ where, data }: any) => {
      const o = this.orgs.find((x) => x.id === where.id)!;
      Object.assign(o, data);
      return { ...o };
    },
  };

  staff_auth_event = {
    create: async ({ data }: any) => {
      this.events.push(data);
      return data;
    },
  };

  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    const users = structuredClone(this.users);
    const orgs = structuredClone(this.orgs);
    const members = structuredClone(this.members);
    try {
      return await fn(this);
    } catch (err) {
      this.users = users;
      this.orgs = orgs;
      this.members = members;
      throw err;
    }
  }
}

/** OrganizationService.create stand-in: upsert by the owner's membership, slug from the name. */
export class FakeOrganizations {
  constructor(private readonly db: FakeStaffPrisma) {}

  async create(
    data: { name: string; type: string },
    owner: {
      id: string;
      phone: string;
      first_name: string | null;
      last_name: string | null;
    },
  ) {
    const slug = data.name.toLowerCase().replace(/\s+/g, '-');
    const member = this.db.members.find((m) => m.user_id === owner.id);
    const existing =
      member && this.db.orgs.find((o) => o.id === member.organization_id);
    if (existing) {
      Object.assign(existing, { name: data.name, type: data.type, slug });
      return { ...existing };
    }
    const row: OrgRow = {
      id: this.db.nextId('org'),
      slug,
      is_active: false,
      ...data,
    };
    this.db.orgs.push(row);
    this.db.members.push({
      id: this.db.nextId('member'),
      organization_id: row.id,
      user_id: owner.id,
      role: 'owner',
      status: 'active',
      phone: owner.phone,
      first_name: owner.first_name ?? '',
      last_name: owner.last_name,
    });
    return { ...row };
  }
}

/** Stands in for StaffSessionService: deterministic tokens, no session table. */
export class FakeStaffSessions {
  async create(userId: string) {
    return {
      accessToken: `access:${userId}`,
      refreshToken: `refresh:${userId}`,
    };
  }
}

export function makeStaffAuthDeps(cfg: CustomerAuthConfig = staffTestConfig) {
  const redis = new FakeRedis();
  const sms = new FakeSms();
  const db = new FakeStaffPrisma();
  const r = redis as unknown as Redis;
  const rateLimit = new RateLimitService(r);
  const otp = new CustomerOtpService(r, cfg, sms, rateLimit);
  const events = new StaffAuthEventService(db as any);
  const throttle = new StaffLoginThrottleService(r);
  return {
    redis,
    sms,
    db,
    r,
    rateLimit,
    otp,
    events,
    throttle,
    organizations: new FakeOrganizations(db),
    sessions: new FakeStaffSessions(),
  };
}
