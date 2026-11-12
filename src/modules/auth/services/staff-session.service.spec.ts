import { randomUUID } from 'crypto';
import { FakeRedis } from 'src/infra/redis/redis.fake';
import { StaffSessionService } from './staff-session.service';

type Row = {
  id: string;
  family_id: string;
  family_started_at: Date;
  user_id: string;
  token_hash: Buffer;
  parent_id: string | null;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  user_agent: string | null;
  ip: string | null;
};

/** In-memory staff_session with just the queries StaffSessionService makes. */
class FakeSessionDb {
  rows: Row[] = [];
  users = new Map<string, { id: string; isActive: boolean }>([
    ['u-1', { id: 'u-1', isActive: true }],
  ]);

  private seq = 0;

  private matches(row: Row, where: Record<string, any>) {
    return Object.entries(where).every(([k, v]) => {
      const actual = (row as any)[k];
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('in' in v) return v.in.includes(actual);
        if ('not' in v) return actual !== v.not;
        if ('gt' in v) return actual > v.gt;
      }
      return actual === v;
    });
  }

  staff_session = {
    create: async ({ data }: { data: Partial<Row> }) => {
      const row = {
        id: randomUUID(),
        parent_id: null,
        used_at: null,
        revoked_at: null,
        user_agent: null,
        ip: null,
        created_at: new Date(Date.now() + ++this.seq),
        ...data,
      } as Row;
      this.rows.push(row);
      return row;
    },
    findUnique: async ({
      where,
      include,
    }: {
      where: { token_hash?: Buffer; id?: string };
      include?: unknown;
    }) => {
      const row = this.rows.find((r) =>
        where.token_hash
          ? r.token_hash.equals(where.token_hash)
          : r.id === where.id,
      );
      if (!row) return null;
      return include
        ? { ...row, user: this.users.get(row.user_id) ?? null }
        : { ...row };
    },
    findMany: async ({
      where,
      distinct,
    }: {
      where: Record<string, unknown>;
      distinct?: string[];
    }) => {
      const hit = this.rows.filter((r) => this.matches(r, where));
      const rows = distinct
        ? hit.filter(
            (r, i) => hit.findIndex((o) => o.family_id === r.family_id) === i,
          )
        : hit;
      return rows
        .map((r) => ({ ...r }))
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      const row = this.rows.find((r) => this.matches(r, where));
      return row ? { ...row } : null;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Partial<Row>;
    }) => {
      const hit = this.rows.filter((r) => this.matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
  };
}

const CTX = { ip: '127.0.0.1', userAgent: 'jest' };

describe('StaffSessionService', () => {
  let db: FakeSessionDb;
  let events: { log: jest.Mock };
  let redis: FakeRedis;
  let service: StaffSessionService;

  beforeEach(() => {
    db = new FakeSessionDb();
    events = { log: jest.fn() };
    redis = new FakeRedis();
    service = new StaffSessionService(
      db as any,
      {
        getJWT: (_t: string, sub: string, _r: string, sid: string) =>
          `access:${sub}:${sid}`,
      } as any,
      events as any,
      redis as any,
    );
  });

  it('login stores only the hash of an opaque refresh token', async () => {
    const pair = await service.create('u-1', CTX);
    expect(pair.accessToken).toBe(`access:u-1:${db.rows[0].family_id}`);
    expect(pair.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(db.rows).toHaveLength(1);
    expect(JSON.stringify(db.rows[0])).not.toContain(pair.refreshToken);
  });

  it('refresh rotates: a new token works, the spent one is refused after the leeway', async () => {
    const first = await service.create('u-1', CTX);
    const second = await service.refresh(first.refreshToken, CTX);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(db.rows[1]).toMatchObject({
      family_id: db.rows[0].family_id,
      parent_id: db.rows[0].id,
    });

    // Within the leeway (lost response) the spent token still works
    await expect(
      service.refresh(first.refreshToken, CTX),
    ).resolves.toHaveProperty('refreshToken');

    // After the leeway it is theft: the whole family is revoked
    db.rows[0].used_at = new Date(Date.now() - 60_000);
    await expect(
      service.refresh(first.refreshToken, CTX),
    ).rejects.toMatchObject({ code: 'invalid_refresh_token' });
    expect(db.rows.every((r) => r.revoked_at)).toBe(true);
    await expect(
      service.refresh(second.refreshToken, CTX),
    ).rejects.toMatchObject({ status: 401 });
    expect(events.log).toHaveBeenCalledWith(
      'staff_refresh_reuse_detected',
      CTX,
      expect.anything(),
    );
  });

  it('logout revokes the login, so its refresh token stops working; other logins stay', async () => {
    const mine = await service.create('u-1', CTX);
    const other = await service.create('u-1', CTX);
    const rotated = await service.refresh(mine.refreshToken, CTX);

    await service.logout(rotated.refreshToken, CTX);
    await expect(
      service.refresh(rotated.refreshToken, CTX),
    ).rejects.toMatchObject({ code: 'invalid_refresh_token' });
    await expect(
      service.refresh(other.refreshToken, CTX),
    ).resolves.toHaveProperty('accessToken');
    expect(events.log).toHaveBeenCalledWith('staff_logout', CTX, {
      userId: 'u-1',
    });
  });

  it('logout is idempotent and ignores unknown or missing tokens', async () => {
    await expect(service.logout(undefined, CTX)).resolves.toBeUndefined();
    await expect(service.logout('nope', CTX)).resolves.toBeUndefined();
    expect(events.log).not.toHaveBeenCalled();
  });

  it('refuses unknown, expired and deactivated-user tokens', async () => {
    await expect(service.refresh('nope', CTX)).rejects.toMatchObject({
      code: 'invalid_refresh_token',
    });

    const expired = await service.create('u-1', CTX);
    db.rows[0].expires_at = new Date(Date.now() - 1000);
    await expect(
      service.refresh(expired.refreshToken, CTX),
    ).rejects.toMatchObject({ code: 'invalid_refresh_token' });

    const pair = await service.create('u-1', CTX);
    db.users.set('u-1', { id: 'u-1', isActive: false });
    await expect(service.refresh(pair.refreshToken, CTX)).rejects.toMatchObject(
      { code: 'invalid_refresh_token' },
    );
    expect(db.rows[1].revoked_at).not.toBeNull();
  });

  describe('sessions of the owner', () => {
    const CHROME =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

    beforeEach(() => {
      db.users.set('u-2', { id: 'u-2', isActive: true });
    });

    it('puts the login id in the access token as sid', async () => {
      const pair = await service.create('u-1', CTX);
      const refreshed = await service.refresh(pair.refreshToken, CTX);
      expect(refreshed.accessToken).toBe(`access:u-1:${db.rows[0].family_id}`);
    });

    it('lists only own active logins, marks the current one, masks the address', async () => {
      await service.create('u-1', { ip: '203.0.113.7', userAgent: CHROME });
      const mine = await service.create('u-1', CTX);
      await service.create('u-2', CTX);
      const rotated = await service.refresh(mine.refreshToken, {
        ip: '198.51.100.9',
        userAgent: CHROME,
      });
      const currentSid = db.rows[1].family_id;

      const list = await service.listActive('u-1', currentSid);
      expect(list).toHaveLength(2);
      expect(list.filter((x) => x.current)).toHaveLength(1);
      expect(list.find((x) => x.current)).toMatchObject({
        id: currentSid,
        device: 'desktop',
        browser: 'Chrome',
        os: 'Windows',
        ipMasked: '198.51.*.*',
      });
      expect(JSON.stringify(list)).not.toContain('203.0.113.7');
      expect(JSON.stringify(list)).not.toContain(rotated.refreshToken);
    });

    it('does not list ended, expired or over-age logins', async () => {
      const a = await service.create('u-1', CTX);
      await service.create('u-1', CTX);
      await service.create('u-1', CTX);
      await service.create('u-1', CTX);
      await service.logout(a.refreshToken, CTX);
      db.rows[1].expires_at = new Date(Date.now() - 1000);
      db.rows[2].family_started_at = new Date(Date.now() - 40 * 86_400_000);
      const list = await service.listActive('u-1', undefined);
      expect(list.map((x) => x.id)).toEqual([db.rows[3].family_id]);
    });

    it('ends one login: its refresh token dies and its access token is denied', async () => {
      const a = await service.create('u-1', CTX);
      const b = await service.create('u-1', CTX);
      const sidA = db.rows[0].family_id;

      await service.end('u-1', sidA, CTX);
      await expect(service.refresh(a.refreshToken, CTX)).rejects.toMatchObject({
        code: 'invalid_refresh_token',
      });
      expect(await service.isSidRevoked(sidA)).toBe(true);
      expect(await service.isSidRevoked(db.rows[1].family_id)).toBe(false);
      await expect(service.refresh(b.refreshToken, CTX)).resolves.toBeDefined();
      expect(events.log).toHaveBeenCalledWith('staff_session_revoked', CTX, {
        userId: 'u-1',
      });
    });

    it('cannot end the login of another owner, an unknown one or one already ended', async () => {
      const theirs = await service.create('u-2', CTX);
      const sid = db.rows[0].family_id;

      await expect(service.end('u-1', sid, CTX)).rejects.toMatchObject({
        code: 'not_found',
      });
      await expect(
        service.end('u-1', '00000000-0000-4000-8000-000000000000', CTX),
      ).rejects.toMatchObject({ code: 'not_found' });
      expect(db.rows[0].revoked_at).toBeNull();
      expect(await service.isSidRevoked(sid)).toBe(false);
      await expect(
        service.refresh(theirs.refreshToken, CTX),
      ).resolves.toBeDefined();

      await service.end('u-2', sid, CTX);
      await expect(service.end('u-2', sid, CTX)).rejects.toMatchObject({
        code: 'not_found',
      });
    });

    it('ends all logins except the current one, and never touches other owners', async () => {
      const current = await service.create('u-1', CTX);
      const other1 = await service.create('u-1', CTX);
      const other2 = await service.create('u-1', CTX);
      const stranger = await service.create('u-2', CTX);
      const currentSid = db.rows[0].family_id;

      await service.endOthers('u-1', currentSid, CTX);

      for (const t of [other1, other2])
        await expect(
          service.refresh(t.refreshToken, CTX),
        ).rejects.toMatchObject({
          code: 'invalid_refresh_token',
        });
      await expect(
        service.refresh(current.refreshToken, CTX),
      ).resolves.toBeDefined();
      await expect(
        service.refresh(stranger.refreshToken, CTX),
      ).resolves.toBeDefined();
      expect(await service.isSidRevoked(currentSid)).toBe(false);
      expect(events.log).toHaveBeenCalledWith(
        'staff_sessions_revoked_all',
        CTX,
        { userId: 'u-1', meta: { sessions_ended: 2 } },
      );
    });

    it('revokeAllForUser without an exception ends every login', async () => {
      const a = await service.create('u-1', CTX);
      await service.create('u-1', CTX);
      expect(await service.revokeAllForUser('u-1')).toBe(2);
      await expect(service.refresh(a.refreshToken, CTX)).rejects.toMatchObject({
        code: 'invalid_refresh_token',
      });
      expect(await service.revokeAllForUser('u-1')).toBe(0);
    });

    it('the denylist entry lives as long as an access token', async () => {
      await service.create('u-1', CTX);
      const sid = db.rows[0].family_id;
      await service.revokeFamily(sid);
      expect(await redis.ttl(`staff:sid:revoked:${sid}`)).toBe(86_400);
    });
  });
});
