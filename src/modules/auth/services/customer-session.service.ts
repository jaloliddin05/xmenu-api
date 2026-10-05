import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { REDIS } from 'src/infra/redis/redis.module';
import { CUSTOMER_AUTH_CONFIG } from '../customer-auth.config';
import type { CustomerAuthConfig } from '../customer-auth.config';
import { CustomerTokenService } from './customer-token.service';
import { CustomerAuthException } from '../errors/customer-auth.exception';
import { CustomerAuthEventService, RequestCtx } from './customer-auth-event.service';

type Db = Prisma.TransactionClient | PrismaService;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const DAY_MS = 86_400_000;

export const sha256 = (value: string) => createHash('sha256').update(value).digest();

@Injectable()
export class CustomerSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: CustomerTokenService,
    private readonly events: CustomerAuthEventService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CUSTOMER_AUTH_CONFIG) private readonly cfg: CustomerAuthConfig,
  ) {}

  // ---------- denylist (access'ni darhol bekor qilish) ----------

  async denySid(sid: string): Promise<void> {
    await this.redis.set(`sid:revoked:${sid}`, '1', 'EX', this.cfg.accessTtlSeconds);
  }

  async isSidDenied(sid: string): Promise<boolean> {
    return (await this.redis.exists(`sid:revoked:${sid}`)) === 1;
  }

  // ---------- yaratish ----------

  private newRefreshToken() {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: sha256(token) };
  }

  private expiryFor(familyStartedAt: Date): Date {
    const sliding = Date.now() + this.cfg.refreshTtlDays * DAY_MS;
    const absolute = familyStartedAt.getTime() + this.cfg.sessionAbsoluteDays * DAY_MS;
    return new Date(Math.min(sliding, absolute));
  }

  /** Yangi login = yangi oila. Bitta mijozda eng ko'pi bilan maxActiveFamilies ta faol oila. */
  async createSession(
    db: Db,
    customerId: string,
    tenantId: string,
    ctx: RequestCtx,
  ): Promise<TokenPair> {
    await this.evictOldFamilies(db, customerId);

    const familyId = randomUUID();
    const now = new Date();
    const { token, hash } = this.newRefreshToken();

    await db.customer_session.create({
      data: {
        family_id: familyId,
        family_started_at: now,
        customer_id: customerId,
        organization_id: tenantId,
        token_hash: hash,
        expires_at: this.expiryFor(now),
        user_agent: ctx.userAgent || null,
        ip: ctx.ip || null,
      },
    });

    return {
      accessToken: this.tokens.signAccess(customerId, tenantId, familyId),
      refreshToken: token,
    };
  }

  private async evictOldFamilies(db: Db, customerId: string) {
    // Faol oila = hali ishlatilmagan, bekor qilinmagan, muddati o'tmagan "barg" qator
    const leaves = await db.customer_session.findMany({
      where: { customer_id: customerId, used_at: null, revoked_at: null, expires_at: { gt: new Date() } },
      orderBy: { family_started_at: 'asc' },
      select: { family_id: true },
    });
    const excess = leaves.length - (this.cfg.maxActiveFamilies - 1);
    if (excess <= 0) return;

    for (const { family_id } of leaves.slice(0, excess)) {
      await db.customer_session.updateMany({
        where: { family_id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      await this.denySid(family_id);
    }
  }

  // ---------- bekor qilish ----------

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.customer_session.updateMany({
      where: { family_id: familyId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    await this.denySid(familyId);
  }

  // ---------- refresh ----------

  async refresh(refreshToken: string, tenantId: string, ctx: RequestCtx): Promise<TokenPair> {
    const invalid = () => new CustomerAuthException('invalid_refresh_token');
    const now = new Date();

    const session = await this.prisma.customer_session.findUnique({
      where: { token_hash: sha256(refreshToken) },
      include: { customer: true },
    });

    if (!session || session.revoked_at || session.expires_at <= now) throw invalid();
    // Boshqa tenant tokeni: oilaga tegmaymiz, shunchaki rad etamiz
    if (session.organization_id !== tenantId) throw invalid();
    if (session.family_started_at.getTime() + this.cfg.sessionAbsoluteDays * DAY_MS <= now.getTime()) {
      throw invalid();
    }

    const customer = session.customer;
    if (!customer || customer.deleted_at || customer.status === 'blocked') {
      await this.revokeFamily(session.family_id);
      await this.events.log('customer_blocked_attempt', ctx, {
        tenantId,
        customerId: customer?.id,
        phone: customer?.phone,
        meta: { via: 'refresh' },
      });
      throw new CustomerAuthException('customer_blocked');
    }

    if (session.used_at) {
      await this.assertWithinLeeway(session, ctx, tenantId);
    } else {
      // Atomarno "ishlatildi" deb belgilash: faqat bitta parallel so'rov g'olib bo'ladi
      const claimed = await this.prisma.customer_session.updateMany({
        where: { id: session.id, used_at: null },
        data: { used_at: now },
      });
      if (claimed.count === 0) {
        const fresh = await this.prisma.customer_session.findUnique({ where: { id: session.id } });
        if (!fresh || fresh.revoked_at) throw invalid();
        await this.assertWithinLeeway(fresh, ctx, tenantId);
      }
    }

    const { token, hash } = this.newRefreshToken();
    await this.prisma.customer_session.create({
      data: {
        family_id: session.family_id,
        family_started_at: session.family_started_at,
        customer_id: customer.id,
        organization_id: tenantId,
        token_hash: hash,
        parent_id: session.id,
        expires_at: this.expiryFor(session.family_started_at),
        user_agent: ctx.userAgent || null,
        ip: ctx.ip || null,
      },
    });

    await this.events.log('refresh', ctx, { tenantId, customerId: customer.id, phone: customer.phone });

    return {
      accessToken: this.tokens.signAccess(customer.id, tenantId, session.family_id),
      refreshToken: token,
    };
  }

  /** Ishlatilgan token: leeway ichida bo'lsa (javob yo'qolgan holat) ruxsat, aks holda o'g'irlik. */
  private async assertWithinLeeway(
    session: { id: string; family_id: string; used_at: Date | null; revoked_at: Date | null; customer_id: string },
    ctx: RequestCtx,
    tenantId: string,
  ) {
    const usedAt = session.used_at?.getTime() ?? 0;
    const withinLeeway = Date.now() - usedAt <= this.cfg.refreshReuseLeewaySeconds * 1000;
    if (withinLeeway && !session.revoked_at) return;

    await this.revokeFamily(session.family_id);
    await this.events.log('refresh_reuse_detected', ctx, {
      tenantId,
      customerId: session.customer_id,
      meta: { family_id: session.family_id },
    });
    throw new CustomerAuthException('invalid_refresh_token');
  }

  // ---------- logout ----------

  /** Har doim muvaffaqiyatli (idempotent). Noma'lum / boshqa tenant tokeni e'tiborsiz qoldiriladi. */
  async logout(refreshToken: string | undefined, tenantId: string, ctx: RequestCtx): Promise<void> {
    if (!refreshToken) return;
    const session = await this.prisma.customer_session.findUnique({
      where: { token_hash: sha256(refreshToken) },
    });
    if (!session || session.organization_id !== tenantId) return;

    await this.revokeFamily(session.family_id);
    await this.events.log('logout', ctx, { tenantId, customerId: session.customer_id });
  }

  // ---------- fon tozalash ----------

  async cleanup(): Promise<{ sessions: number; events: number }> {
    const sessions = await this.prisma.customer_session.deleteMany({
      where: { expires_at: { lt: new Date(Date.now() - 7 * DAY_MS) } },
    });
    const events = await this.prisma.customer_auth_event.deleteMany({
      where: { created_at: { lt: new Date(Date.now() - 90 * DAY_MS) } },
    });
    return { sessions: sessions.count, events: events.count };
  }
}
