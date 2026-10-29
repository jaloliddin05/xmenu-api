import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { CustomerAuthException } from '../errors/customer-auth.exception';
import { JwtTokenService } from '../jwt.service';
import type { RequestCtx } from './customer-auth-event.service';
import { sha256 } from './customer-session.service';
import { StaffAuthEventService } from './staff-auth-event.service';

type Db = Prisma.TransactionClient | PrismaService;

export interface StaffTokenPair {
  accessToken: string;
  refreshToken: string;
}

const DAY_MS = 86_400_000;

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

export const loadStaffSessionConfig = (env = process.env): StaffSessionConfig => ({
  refreshTtlDays: positive(env.STAFF_REFRESH_TTL_DAYS, 7),
  absoluteDays: positive(env.STAFF_SESSION_ABSOLUTE_DAYS, 30),
  reuseLeewaySeconds: positive(env.STAFF_REFRESH_REUSE_LEEWAY_SECONDS, 30),
});

/**
 * Owner sessions (staff_session): opaque refresh tokens stored as SHA-256, rotated on every refresh.
 * A rotated token presented again after the leeway revokes the whole login (family). Logout revokes the
 * family. Access tokens stay stateless JWTs and live until they expire (JWT_ACCESS_TOKEN_EXPIRATION_TIME).
 */
@Injectable()
export class StaffSessionService {
  private readonly cfg = loadStaffSessionConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtTokenService,
    private readonly events: StaffAuthEventService,
  ) {}

  private newRefreshToken() {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: sha256(token) };
  }

  private expiryFor(familyStartedAt: Date): Date {
    const sliding = Date.now() + this.cfg.refreshTtlDays * DAY_MS;
    const absolute = familyStartedAt.getTime() + this.cfg.absoluteDays * DAY_MS;
    return new Date(Math.min(sliding, absolute));
  }

  private pair(userId: string, refreshToken: string): StaffTokenPair {
    return { accessToken: this.jwt.getJWT('access', userId, 'user'), refreshToken };
  }

  /** New login = new family. */
  async create(userId: string, ctx: RequestCtx, db: Db = this.prisma): Promise<StaffTokenPair> {
    const now = new Date();
    const { token, hash } = this.newRefreshToken();
    await db.staff_session.create({
      data: {
        family_id: randomUUID(),
        family_started_at: now,
        user_id: userId,
        token_hash: hash,
        expires_at: this.expiryFor(now),
        user_agent: ctx.userAgent || null,
        ip: ctx.ip || null,
      },
    });
    return this.pair(userId, token);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.staff_session.updateMany({
      where: { family_id: familyId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  /** POST /auth/refresh: the old token is spent, a new pair is issued. */
  async refresh(refreshToken: string, ctx: RequestCtx): Promise<StaffTokenPair> {
    const invalid = () => new CustomerAuthException('invalid_refresh_token');
    const now = new Date();

    const session = await this.prisma.staff_session.findUnique({
      where: { token_hash: sha256(refreshToken) },
      include: { user: { select: { id: true, isActive: true } } },
    });
    if (!session || session.revoked_at || session.expires_at <= now) throw invalid();
    if (session.family_started_at.getTime() + this.cfg.absoluteDays * DAY_MS <= now.getTime()) throw invalid();
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
        const fresh = await this.prisma.staff_session.findUnique({ where: { id: session.id } });
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
    return this.pair(session.user_id, token);
  }

  private async assertWithinLeeway(
    session: { family_id: string; user_id: string; used_at: Date | null; revoked_at: Date | null },
    ctx: RequestCtx,
  ) {
    const usedAt = session.used_at?.getTime() ?? 0;
    if (!session.revoked_at && Date.now() - usedAt <= this.cfg.reuseLeewaySeconds * 1000) return;
    await this.revokeFamily(session.family_id);
    await this.events.log('staff_refresh_reuse_detected', ctx, {
      userId: session.user_id,
      meta: { family_id: session.family_id },
    });
    throw new CustomerAuthException('invalid_refresh_token');
  }

  /** POST /auth/logout: always succeeds; an unknown token is ignored. */
  async logout(refreshToken: string | undefined, ctx: RequestCtx): Promise<void> {
    if (!refreshToken) return;
    const session = await this.prisma.staff_session.findUnique({
      where: { token_hash: sha256(refreshToken) },
    });
    if (!session) return;
    await this.revokeFamily(session.family_id);
    await this.events.log('staff_logout', ctx, { userId: session.user_id });
  }
}
