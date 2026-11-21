import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from 'src/infra/redis/redis.module';
import { AppException } from 'src/infra/errors/app-exception';

interface LockRule {
  /** Failures within `failWindowSeconds` that lock */
  fails: number;
  failWindowSeconds: number;
  /** First lock; every next one doubles up to `maxLockSeconds` */
  baseLockSeconds: number;
  maxLockSeconds: number;
  /** The escalation level is forgotten after this long without a lock */
  levelTtlSeconds: number;
}

/** Strict: one phone from one IP (the guesser). */
const PAIR: LockRule = {
  fails: 5,
  failWindowSeconds: 900,
  baseLockSeconds: 60,
  maxLockSeconds: 3600,
  levelTtlSeconds: 86400,
};

/** Soft: one phone from any IPs, so many addresses cannot guess freely; shorter, it is what a stranger can cause. */
const PHONE: LockRule = {
  fails: 20,
  failWindowSeconds: 900,
  baseLockSeconds: 60,
  maxLockSeconds: 900,
  levelTtlSeconds: 3600,
};

export const LOGIN_FAILS_BEFORE_LOCK = PAIR.fails;
export const PHONE_FAILS_BEFORE_LOCK = PHONE.fails;

// Outlives every pair key (they live at most PAIR.levelTtlSeconds after the last failure)
const GENERATION_TTL_SECONDS = 2 * 86400;

/**
 * Escalating lockout of owner login, two counters (audit S-14): the pair "phone + IP" locks after
 * LOGIN_FAILS_BEFORE_LOCK failures (60 s, doubling up to an hour), the phone as a whole only after
 * PHONE_FAILS_BEFORE_LOCK failures from any IPs and for a shorter time. So a stranger guessing from a few
 * addresses locks only those pairs, not the owner. Counters exist for any phone string, registered or not, so a lockout
 * says nothing about the account. Pair keys carry the phone's generation: a password reset moves it on and every
 * pair of the phone is forgotten at once.
 */
@Injectable()
export class StaffLoginThrottleService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private generationKey(phone: string) {
    return `staff:login:gen:${phone}`;
  }

  private async scopes(phone: string, ip: string) {
    const gen = (await this.redis.get(this.generationKey(phone))) ?? '0';
    return [
      { rule: PAIR, prefix: `staff:login:pair:${phone}:${gen}:${ip}` },
      { rule: PHONE, prefix: `staff:login:phone:${phone}` },
    ];
  }

  private keys(prefix: string) {
    return {
      fail: `${prefix}:fail`,
      level: `${prefix}:lvl`,
      lock: `${prefix}:lock`,
    };
  }

  /** 429 too_many_attempts with retryAfter while the pair or the phone is locked (the longer of the two). */
  async assertNotLocked(phone: string, ip: string): Promise<void> {
    let retryAfter = 0;
    for (const { prefix } of await this.scopes(phone, ip)) {
      retryAfter = Math.max(
        retryAfter,
        await this.redis.ttl(this.keys(prefix).lock),
      );
    }
    if (retryAfter > 0) {
      throw new AppException('too_many_attempts', {
        message: 'Too many login attempts',
        retryAfter,
      });
    }
  }

  /** Counts a failure on both counters; returns the lock length if this failure triggered a lock. */
  async registerFailure(phone: string, ip: string): Promise<number | null> {
    let locked: number | null = null;
    for (const { rule, prefix } of await this.scopes(phone, ip)) {
      const seconds = await this.fail(rule, this.keys(prefix));
      if (seconds !== null) locked = Math.max(locked ?? 0, seconds);
    }
    return locked;
  }

  private async fail(
    rule: LockRule,
    k: ReturnType<StaffLoginThrottleService['keys']>,
  ): Promise<number | null> {
    const fails = await this.redis.incr(k.fail);
    if (fails === 1) await this.redis.expire(k.fail, rule.failWindowSeconds);
    if (fails < rule.fails) return null;

    await this.redis.del(k.fail);
    const level = await this.redis.incr(k.level);
    await this.redis.expire(k.level, rule.levelTtlSeconds);
    const seconds = Math.min(
      rule.baseLockSeconds * 2 ** (level - 1),
      rule.maxLockSeconds,
    );
    await this.redis.set(k.lock, '1', 'EX', seconds);
    return seconds;
  }

  /** After a successful login: this pair starts afresh; failures others caused on the phone stay counted. */
  async clearPair(phone: string, ip: string): Promise<void> {
    const [pair] = await this.scopes(phone, ip);
    const k = this.keys(pair.prefix);
    await this.redis.del(k.fail, k.level, k.lock);
  }

  /** Password reset: every lock and counter of the phone is gone, from every IP. */
  async reset(phone: string): Promise<void> {
    const gen = this.generationKey(phone);
    await this.redis.incr(gen);
    await this.redis.expire(gen, GENERATION_TTL_SECONDS);
    const k = this.keys(`staff:login:phone:${phone}`);
    await this.redis.del(k.fail, k.level, k.lock);
  }
}
