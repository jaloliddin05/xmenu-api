import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type Redis from 'ioredis';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { JwtTokenService } from '../jwt.service';
import type { RequestCtx } from './customer-auth-event.service';
import { sha256 } from './customer-session.service';
import { StaffAuthEventService } from './staff-auth-event.service';
import { AppException } from 'src/infra/errors/app-exception';
import { REDIS } from 'src/infra/redis/redis.module';
import { maskIp, parseUserAgent } from 'src/infra/helper/auth/user-agent';

type Db = Prisma.TransactionClient | PrismaService;

export interface StaffTokenPair {
  accessToken: string;
  refreshToken: string;
}

const DAY_MS = 86_400_000;
const FALLBACK_ACCESS_TTL_SECONDS = 86_400;

/** JWT_ACCESS_TOKEN_EXPIRATION_TIME ("3600", "15m", "1h", "7d") in seconds. */
export const accessTtlSeconds = (raw: string | undefined): number => {
  const m = /^(\d+)\s*([smhd]?)$/.exec(String(raw ?? '').trim());
  if (!m) return FALLBACK_ACCESS_TTL_SECONDS;
  const unit = { '': 1, s: 1, m: 60, h: 3600, d: 86_400 }[m[2]] as number;
  return Number(m[1]) * unit || FALLBACK_ACCESS_TTL_SECONDS;
};

export interface StaffSessionInfo {
  id: string;
  device: string;
  browser: string | null;
  os: string | null;
  ipMasked: string | null;
  lastActiveAt: Date;
  createdAt: Date;
  current: boolean;
}

export interface StaffSessionConfig {
  /** Sliding lifetime of one refresh token. */
  refreshTtlDays: number;
  /** A login never lives longer than this, however often it is refreshed. */
  absoluteDays: number;
  /** A used token presented again within this window is a lost response, not theft. */
  reuseLeewaySeconds: number;
}

const positive = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const loadStaffSessionConfig = (
  env = process.env,
): StaffSessionConfig => ({
  refreshTtlDays: positive(env.STAFF_REFRESH_TTL_DAYS, 7),
  absoluteDays: positive(env.STAFF_SESSION_ABSOLUTE_DAYS, 30),
  reuseLeewaySeconds: positive(env.STAFF_REFRESH_REUSE_LEEWAY_SECONDS, 30),
});

/**
 * Owner sessions (staff_session): opaque refresh tokens stored as SHA-256, rotated on every refresh.
 * A rotated token presented again after the leeway revokes the whole login (family). Logout revokes the
 * family. Access tokens are JWTs carrying the family id as `sid`; revoking a family also puts the sid on a short
 * Redis denylist (as long as an access token lives), so a revoked device loses access at once.
 */
@Injectable()
export class StaffSessionService {
  private readonly cfg = loadStaffSessionConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtTokenService,
    private readonly events: StaffAuthEventService,
    @Inject(REDIS) private readonly redis: Redis,
    config?: ConfigService,
  ) {
    this.accessTtl = accessTtlSeconds(
      config?.get<{ accessTokenExpiration?: string }>('jwt')
        ?.accessTokenExpiration,
    );
  }

  private readonly accessTtl: number;

  private newRefreshToken() {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: sha256(token) };
  }

  private expiryFor(familyStartedAt: Date): Date {
    const sliding = Date.now() + this.cfg.refreshTtlDays * DAY_MS;
    const absolute = familyStartedAt.getTime() + this.cfg.absoluteDays * DAY_MS;
    return new Date(Math.min(sliding, absolute));
  }

  private pair(
    userId: string,
    familyId: string,
    refreshToken: string,
  ): StaffTokenPair {
    return {
      accessToken: this.jwt.getJWT('access', userId, 'user', familyId),
      refreshToken,
    };
  }

  /** New login = new family. */
  async create(
    userId: string,
    ctx: RequestCtx,
    db: Db = this.prisma,
  ): Promise<StaffTokenPair> {
    const now = new Date();
    const familyId = randomUUID();
    const { token, hash } = this.newRefreshToken();
    await db.staff_session.create({
      data: {
        family_id: familyId,
        family_started_at: now,
        user_id: userId,
        token_hash: hash,
        expires_at: this.expiryFor(now),
        user_agent: ctx.userAgent || null,
        ip: ctx.ip || null,
      },
    });
    return this.pair(userId, familyId, token);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.staff_session.updateMany({
      where: { family_id: familyId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    await this.denySid(familyId);
  }

  private async denySid(sid: string): Promise<void> {
    await this.redis.set(`staff:sid:revoked:${sid}`, '1', 'EX', this.accessTtl);
  }

  /** True once the login behind an access token was revoked. */
  async isSidRevoked(sid: string): Promise<boolean> {
    return (await this.redis.exists(`staff:sid:revoked:${sid}`)) === 1;
  }

  /** Revokes every login of the owner, except `exceptSid` when given. Returns how many logins ended. */
  async revokeAllForUser(userId: string, exceptSid?: string): Promise<number> {
    const rows = await this.prisma.staff_session.findMany({
      where: {
        user_id: userId,
        revoked_at: null,
        ...(exceptSid ? { family_id: { not: exceptSid } } : {}),
      },
      select: { family_id: true },
      distinct: ['family_id'],
    });
    const ids = rows.map((r) => r.family_id);
    if (ids.length === 0) return 0;
    await this.prisma.staff_session.updateMany({
      where: { family_id: { in: ids }, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    await Promise.all(ids.map((id) => this.denySid(id)));
    return ids.length;
  }

  /** Ends one login of this owner; someone else's (or an unknown or already ended) one is 404. */
  async revokeOne(userId: string, sid: string): Promise<void> {
    const row = await this.prisma.staff_session.findFirst({
      where: { family_id: sid, user_id: userId, revoked_at: null },
      select: { id: true },
    });
    if (!row)
      throw new AppException('not_found', { message: 'Session not found' });
    await this.revokeFamily(sid);
  }

  /** DELETE /auth/sessions/:id */
  async end(userId: string, sid: string, ctx: RequestCtx): Promise<void> {
    await this.revokeOne(userId, sid);
    await this.events.log('staff_session_revoked', ctx, { userId });
  }

  /** DELETE /auth/sessions: every login except the current one. */
  async endOthers(
    userId: string,
    currentSid: string,
    ctx: RequestCtx,
  ): Promise<void> {
    const ended = await this.revokeAllForUser(userId, currentSid);
    await this.events.log('staff_sessions_revoked_all', ctx, {
      userId,
      meta: { sessions_ended: ended },
    });
  }

  /** Active logins of the owner, newest activity first. Activity = the last refresh of the login. */
  async listActive(
    userId: string,
    currentSid: string | undefined,
  ): Promise<StaffSessionInfo[]> {
    const now = new Date();
    const rows = await this.prisma.staff_session.findMany({
      where: {
        user_id: userId,
        used_at: null,
        revoked_at: null,
        expires_at: { gt: now },
      },
      orderBy: { created_at: 'desc' },
    });
    return rows
      .filter(
        (r) =>
          r.family_started_at.getTime() + this.cfg.absoluteDays * DAY_MS >
          now.getTime(),
      )
      .map((r) => {
        const ua = parseUserAgent(r.user_agent);
        return {
          id: r.family_id,
          device: ua.device,
          browser: ua.browser,
          os: ua.os,
          ipMasked: maskIp(r.ip),
          lastActiveAt: r.created_at,
          createdAt: r.family_started_at,
          current: r.family_id === currentSid,
        };
      });
  }

  /** POST /auth/refresh: the old token is spent, a new pair is issued. */
  async refresh(
    refreshToken: string,
    ctx: RequestCtx,
  ): Promise<StaffTokenPair> {
    const invalid = () =>
      new AppException('invalid_refresh_token', {
        message: 'Refresh token is invalid, expired or already used',
      });
    const now = new Date();

    const session = await this.prisma.staff_session.findUnique({
      where: { token_hash: sha256(refreshToken) },
      include: { user: { select: { id: true, isActive: true } } },
    });
    if (!session || session.revoked_at || session.expires_at <= now)
      throw invalid();
    if (
      session.family_started_at.getTime() + this.cfg.absoluteDays * DAY_MS <=
      now.getTime()
    )
      throw invalid();
    if (!session.user?.isActive) {
      await this.revokeFamily(session.family_id);
      throw invalid();
    }

    if (session.used_at) {
      await this.assertWithinLeeway(session, ctx);
    } else {
      // Only one of several parallel refreshes claims the row
      const claimed = await this.prisma.staff_session.updateMany({
        where: { id: session.id, used_at: null },
        data: { used_at: now },
      });
      if (claimed.count === 0) {
        const fresh = await this.prisma.staff_session.findUnique({
          where: { id: session.id },
        });
        if (!fresh || fresh.revoked_at) throw invalid();
        await this.assertWithinLeeway(fresh, ctx);
      }
    }

    const { token, hash } = this.newRefreshToken();
    await this.prisma.staff_session.create({
      data: {
        family_id: session.family_id,
        family_started_at: session.family_started_at,
        user_id: session.user_id,
        token_hash: hash,
        parent_id: session.id,
        expires_at: this.expiryFor(session.family_started_at),
        user_agent: ctx.userAgent || null,
        ip: ctx.ip || null,
      },
    });
    return this.pair(session.user_id, session.family_id, token);
  }

  private async assertWithinLeeway(
    session: {
      family_id: string;
      user_id: string;
      used_at: Date | null;
      revoked_at: Date | null;
    },
    ctx: RequestCtx,
  ) {
    const usedAt = session.used_at?.getTime() ?? 0;
    if (
      !session.revoked_at &&
      Date.now() - usedAt <= this.cfg.reuseLeewaySeconds * 1000
    )
      return;
    await this.revokeFamily(session.family_id);
    await this.events.log('staff_refresh_reuse_detected', ctx, {
      userId: session.user_id,
      meta: { family_id: session.family_id },
    });
    throw new AppException('invalid_refresh_token', {
      message: 'Refresh token is invalid, expired or already used',
    });
  }

  /** POST /auth/logout: always succeeds; an unknown token is ignored. */
  async logout(
    refreshToken: string | undefined,
    ctx: RequestCtx,
  ): Promise<void> {
    if (!refreshToken) return;
    const session = await this.prisma.staff_session.findUnique({
      where: { token_hash: sha256(refreshToken) },
    });
    if (!session) return;
    await this.revokeFamily(session.family_id);
    await this.events.log('staff_logout', ctx, { userId: session.user_id });
  }
}
