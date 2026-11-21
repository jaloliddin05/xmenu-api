import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from 'src/infra/redis/redis.module';
import { AppException } from 'src/infra/errors/app-exception';
import { errorMessage } from 'src/infra/helper/error-text';
import { Env } from 'src/config/env/env-issues';
import { OpsNotifierService } from 'src/modules/order/notifications/ops-notifier.service';

// Asia/Tashkent is UTC+5 all year (no daylight saving)
const TASHKENT_OFFSET_SECONDS = 5 * 3600;
const DAY_SECONDS = 86400;
// Counters and alert marks outlive their day a little, then go away by themselves
const KEY_TTL_SECONDS = 2 * DAY_SECONDS;
const WARN_SHARE = 0.8;

export interface SmsDailyLimits {
  platform: number | null;
  tenant: number | null;
}

function ceiling(raw: string | undefined): number | null {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : null;
}

/** SMS_DAILY_LIMIT_PLATFORM, SMS_DAILY_LIMIT_TENANT; unset = no ceiling (production requires both: validateEnv). */
export function smsDailyLimits(env: Env = process.env): SmsDailyLimits {
  return {
    platform: ceiling(env.SMS_DAILY_LIMIT_PLATFORM),
    tenant: ceiling(env.SMS_DAILY_LIMIT_TENANT),
  };
}

/** The calendar day in Tashkent, `YYYY-MM-DD`. */
export function tashkentDay(nowMs: number): string {
  return new Date(nowMs + TASHKENT_OFFSET_SECONDS * 1000)
    .toISOString()
    .slice(0, 10);
}

/** Seconds until the next midnight in Tashkent (at least 1). */
export function secondsToTashkentMidnight(nowMs: number): number {
  const into =
    (Math.floor(nowMs / 1000) + TASHKENT_OFFSET_SECONDS) % DAY_SECONDS;
  return Math.max(1, DAY_SECONDS - into);
}

interface Ceiling {
  /** For keys and the alert text */
  scope: 'platform' | 'tenant';
  tenantId?: string;
  key: string;
  limit: number;
}

/**
 * Daily SMS ceilings (audit S-18): one for the whole platform and one per venue, counted per day of Asia/Tashkent in
 * Redis. Every SMS counts towards the platform ceiling, an SMS sent for a venue (guest codes, branch escalation)
 * towards the venue's too. At 80% of a ceiling the ops chat gets one alert a day; over it the SMS is refused with
 * 429 sms_limit (retryAfter: until midnight in Tashkent) and the ops chat gets one more alert a day.
 */
@Injectable()
export class SmsBudgetService {
  private readonly logger = new Logger('SmsBudget');
  /** Clock; tests move it */
  now: () => number = () => Date.now();

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly ops: OpsNotifierService,
  ) {}

  private ceilings(tenantId: string | undefined): Ceiling[] {
    const limits = smsDailyLimits();
    const day = tashkentDay(this.now());
    const out: Ceiling[] = [];
    if (limits.platform !== null)
      out.push({
        scope: 'platform',
        key: `sms:budget:platform:${day}`,
        limit: limits.platform,
      });
    if (tenantId && limits.tenant !== null)
      out.push({
        scope: 'tenant',
        tenantId,
        key: `sms:budget:tenant:${tenantId}:${day}`,
        limit: limits.tenant,
      });
    return out;
  }

  /** Takes one SMS from the ceilings, or throws sms_limit and takes nothing. */
  async consume(tenantId?: string): Promise<void> {
    const taken: string[] = [];
    for (const c of this.ceilings(tenantId)) {
      const used = await this.redis.incr(c.key);
      if (used === 1) await this.redis.expire(c.key, KEY_TTL_SECONDS);
      if (used > c.limit) {
        for (const key of [c.key, ...taken]) await this.redis.decr(key);
        await this.alertOnce(c, 'full', used - 1);
        throw this.refused();
      }
      taken.push(c.key);
      if (used >= Math.ceil(c.limit * WARN_SHARE))
        await this.alertOnce(c, 'warn', used);
    }
  }

  /** Refuses (sms_limit) if a ceiling is already used up; takes nothing. For flows that send without waiting. */
  async assertAvailable(tenantId?: string): Promise<void> {
    for (const c of this.ceilings(tenantId)) {
      const used = Number((await this.redis.get(c.key)) ?? 0);
      if (used >= c.limit) {
        await this.alertOnce(c, 'full', used);
        throw this.refused();
      }
    }
  }

  private refused() {
    return new AppException('sms_limit', {
      message: 'Daily SMS limit reached',
      retryAfter: secondsToTashkentMidnight(this.now()),
    });
  }

  /** One alert per ceiling, level and day; a failed alert never stops the SMS decision. */
  private async alertOnce(c: Ceiling, level: 'warn' | 'full', used: number) {
    try {
      const mark = await this.redis.set(
        `${c.key}:alert:${level}`,
        '1',
        'EX',
        KEY_TTL_SECONDS,
        'NX',
      );
      if (mark !== 'OK') return;
      const who =
        c.scope === 'platform' ? 'платформы' : `заведения ${c.tenantId}`;
      await this.ops.alert(
        level === 'warn'
          ? `SMS: использовано ${used} из ${c.limit} суточного лимита ${who} (80%)`
          : `SMS: суточный лимит ${who} исчерпан (${c.limit}), SMS не отправляются до полуночи по Ташкенту`,
      );
    } catch (e) {
      this.logger.warn(`SMS budget alert not sent: ${errorMessage(e)}`);
    }
  }
}

/** Wraps the chosen provider: every SMS goes through the daily ceilings first. */
export class BudgetedSmsProvider {
  constructor(
    private readonly provider: {
      send(phone: string, text: string): Promise<void>;
    },
    private readonly budget: SmsBudgetService,
  ) {}

  async send(
    phone: string,
    text: string,
    opts?: { tenantId?: string },
  ): Promise<void> {
    await this.budget.consume(opts?.tenantId);
    await this.provider.send(phone, text);
  }
}
