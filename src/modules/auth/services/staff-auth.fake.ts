import type Redis from 'ioredis';
import { FakeRedis } from 'src/infra/redis/redis.fake';
import type { SmsProvider } from 'src/modules/sms/providers/sms-provider.interface';
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
  otpDevMode: false,
  smsLocale: 'ru',
} as CustomerAuthConfig;

export class FakeSms implements SmsProvider {
  sent: { phone: string; text: string }[] = [];
  failNext = false;
  async send(phone: string, text: string) {
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
  owner_id: string;
  name: string;
  type: string;
  slug: string;
  is_active: boolean;
}

/**
 * In-memory stand-in for the slice of Prisma the staff auth code touches. `$transaction` runs the
 * callback on a copy and only keeps it if the callback succeeds, like a real rollback.
 */
export class FakeStaffPrisma {
  users: UserRow[] = [];
  orgs: OrgRow[] = [];
  events: { type: string; meta?: unknown; phone_masked: string | null }[] = [];
  private seq = 0;

  nextId(prefix: string) {
    return `${prefix}-${++this.seq}`;
  }

  private withOrg(u: UserRow) {
    return {
      ...u,
      organization: this.orgs.find((o) => o.owner_id === u.id) ?? null,
    };
  }

  user = {
    findUnique: async ({ where, include }: any) => {
      const u = this.users.find((x) =>
        where.id ? x.id === where.id : x.phone === where.phone,
      );
      if (!u) return null;
      return include?.organization ? this.withOrg(u) : { ...u };
    },
    findUniqueOrThrow: async ({ where }: any) => {
      const u = this.users.find((x) => x.id === where.id);
      if (!u) throw new Error('not found');
      return this.withOrg(u);
    },
    create: async ({ data }: any) => {
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
    try {
      return await fn(this);
    } catch (err) {
      this.users = users;
      this.orgs = orgs;
      throw err;
    }
  }
}

/** OrganizationService.create stand-in: upsert by owner, slug from the name. */
export class FakeOrganizations {
  constructor(private readonly db: FakeStaffPrisma) {}

  async create(data: { name: string; type: string }, owner_id: string) {
    const slug = data.name.toLowerCase().replace(/\s+/g, '-');
    const existing = this.db.orgs.find((o) => o.owner_id === owner_id);
    if (existing) {
      Object.assign(existing, { name: data.name, type: data.type, slug });
      return { ...existing };
    }
    const row: OrgRow = {
      id: this.db.nextId('org'),
      owner_id,
      slug,
      is_active: false,
      ...data,
    };
    this.db.orgs.push(row);
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

export function makeStaffAuthDeps() {
  const redis = new FakeRedis();
  const sms = new FakeSms();
  const db = new FakeStaffPrisma();
  const r = redis as unknown as Redis;
  const rateLimit = new RateLimitService(r);
  const otp = new CustomerOtpService(r, staffTestConfig, sms, rateLimit);
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
