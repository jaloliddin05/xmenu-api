import { randomUUID } from 'crypto';
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
};

/** In-memory staff_session with just the queries StaffSessionService makes. */
class FakeSessionDb {
  rows: Row[] = [];
  users = new Map<string, { id: string; isActive: boolean }>([
    ['u-1', { id: 'u-1', isActive: true }],
  ]);

  private matches(row: Row, where: Record<string, unknown>) {
    return Object.entries(where).every(([k, v]) => (row as any)[k] === v);
  }

  staff_session = {
    create: async ({ data }: { data: Partial<Row> }) => {
      const row = {
        id: randomUUID(),
        parent_id: null,
        used_at: null,
        revoked_at: null,
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
  let service: StaffSessionService;

  beforeEach(() => {
    db = new FakeSessionDb();
    events = { log: jest.fn() };
    service = new StaffSessionService(
      db as any,
      { getJWT: (_t: string, sub: string) => `access:${sub}` } as any,
      events as any,
    );
  });

  it('login stores only the hash of an opaque refresh token', async () => {
    const pair = await service.create('u-1', CTX);
    expect(pair.accessToken).toBe('access:u-1');
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
});
