import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from 'src/infra/redis/redis.module';
import { CustomerAuthException } from '../errors/customer-auth.exception';

export const LOGIN_FAILS_BEFORE_LOCK = 5;
const FAIL_WINDOW_SECONDS = 900;
const LEVEL_TTL_SECONDS = 86400;
const BASE_LOCK_SECONDS = 60;
const MAX_LOCK_SECONDS = 3600;

/**
 * Per-phone escalating lockout for owner login: every LOGIN_FAILS_BEFORE_LOCK failures within 15 minutes
 * lock the phone for 60 s, then 120, 240... up to an hour; the level decays after a quiet day. Counters
 * exist for any phone string, registered or not, so a lockout says nothing about the account.
 */
@Injectable()
export class StaffLoginThrottleService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private keys(phone: string) {
    return {
      fail: `staff:login:fail:${phone}`,
      level: `staff:login:lvl:${phone}`,
      lock: `staff:login:lock:${phone}`,
    };
  }

  /** 429 too_many_attempts with retryAfter while the phone is locked. */
  async assertNotLocked(phone: string): Promise<void> {
    const ttl = await this.redis.ttl(this.keys(phone).lock);
    if (ttl > 0) {
      throw new CustomerAuthException('too_many_attempts', 'Too many login attempts', ttl);
    }
  }

  /** Counts a failure; returns the lock length if this failure triggered a lock. */
  async registerFailure(phone: string): Promise<number | null> {
    const k = this.keys(phone);
    const fails = await this.redis.incr(k.fail);
    if (fails === 1) await this.redis.expire(k.fail, FAIL_WINDOW_SECONDS);
    if (fails < LOGIN_FAILS_BEFORE_LOCK) return null;

    await this.redis.del(k.fail);
    const level = await this.redis.incr(k.level);
    await this.redis.expire(k.level, LEVEL_TTL_SECONDS);
    const seconds = Math.min(BASE_LOCK_SECONDS * 2 ** (level - 1), MAX_LOCK_SECONDS);
    await this.redis.set(k.lock, '1', 'EX', seconds);
    return seconds;
  }

  async reset(phone: string): Promise<void> {
    const k = this.keys(phone);
    await this.redis.del(k.fail, k.level, k.lock);
  }
}
