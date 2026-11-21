import type Redis from 'ioredis';
import { FakeRedis } from 'src/infra/redis/redis.fake';
import { AppException } from 'src/infra/errors/app-exception';
import {
  LOGIN_FAILS_BEFORE_LOCK,
  PHONE_FAILS_BEFORE_LOCK,
  StaffLoginThrottleService,
} from './staff-login-throttle.service';

const PHONE = '+998901234567';
const OWNER_IP = '203.0.113.1';
const ATTACKER_IP = '198.51.100.7';

describe('StaffLoginThrottleService', () => {
  let redis: FakeRedis;
  let throttle: StaffLoginThrottleService;

  beforeEach(() => {
    redis = new FakeRedis();
    throttle = new StaffLoginThrottleService(redis as unknown as Redis);
  });

  async function failUntilLocked(ip = ATTACKER_IP): Promise<number> {
    let lockedFor: number | null = null;
    for (let i = 0; i < LOGIN_FAILS_BEFORE_LOCK; i++) {
      await throttle.assertNotLocked(PHONE, ip);
      lockedFor = await throttle.registerFailure(PHONE, ip);
      if (i < LOGIN_FAILS_BEFORE_LOCK - 1) expect(lockedFor).toBeNull();
    }
    return lockedFor!;
  }

  async function lockedRetryAfter(ip = ATTACKER_IP): Promise<number> {
    const err = await throttle.assertNotLocked(PHONE, ip).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(AppException);
    expect(err.code).toBe('too_many_attempts');
    expect(err.getStatus()).toBe(429);
    return err.retryAfter;
  }

  const notLocked = (ip: string, phone = PHONE) =>
    expect(throttle.assertNotLocked(phone, ip)).resolves.toBeUndefined();

  describe('phone + IP (strict)', () => {
    it('locks after 5 failures and doubles the lock each time', async () => {
      expect(await failUntilLocked()).toBe(60);
      expect(await lockedRetryAfter()).toBe(60);

      redis.advance(60);
      expect(await failUntilLocked()).toBe(120);
      expect(await lockedRetryAfter()).toBe(120);

      redis.advance(120);
      expect(await failUntilLocked()).toBe(240);
    });

    it('caps the lock at one hour', async () => {
      let last = 0;
      for (let i = 0; i < 8; i++) {
        last = await failUntilLocked();
        redis.advance(last);
      }
      expect(last).toBe(3600);
    });

    it('forgets failures outside the 15-minute window', async () => {
      for (let i = 0; i < LOGIN_FAILS_BEFORE_LOCK - 1; i++)
        await throttle.registerFailure(PHONE, ATTACKER_IP);
      redis.advance(900);
      expect(await throttle.registerFailure(PHONE, ATTACKER_IP)).toBeNull();
    });

    it('decays the escalation level after a quiet day', async () => {
      await failUntilLocked();
      redis.advance(60);
      await failUntilLocked();
      redis.advance(86400);
      expect(await failUntilLocked()).toBe(60);
    });

    it('a stranger who locks the pair does not lock the owner on another IP', async () => {
      await failUntilLocked(ATTACKER_IP);
      await lockedRetryAfter(ATTACKER_IP);
      await notLocked(OWNER_IP);
    });

    it('a successful login clears only its own pair', async () => {
      for (let i = 0; i < LOGIN_FAILS_BEFORE_LOCK - 1; i++)
        await throttle.registerFailure(PHONE, OWNER_IP);
      await failUntilLocked(ATTACKER_IP);
      await throttle.clearPair(PHONE, OWNER_IP);
      // a fresh window for the owner
      expect(await throttle.registerFailure(PHONE, OWNER_IP)).toBeNull();
      await notLocked(OWNER_IP);
      // the stranger stays locked
      await lockedRetryAfter(ATTACKER_IP);
    });

    it('keeps phones independent', async () => {
      await failUntilLocked();
      await notLocked(ATTACKER_IP, '+998909999999');
    });
  });

  describe('phone from any IP (soft)', () => {
    /** One failure each from `count` different addresses: no pair ever reaches its own limit. */
    async function spread(count: number, from = 0): Promise<number | null> {
      let locked: number | null = null;
      for (let i = from; i < from + count; i++)
        locked = await throttle.registerFailure(PHONE, `192.0.2.${i}`);
      return locked;
    }

    it('locks the phone everywhere after 20 failures from many IPs, for a shorter time', async () => {
      expect(await spread(PHONE_FAILS_BEFORE_LOCK - 1)).toBeNull();
      await notLocked(OWNER_IP);
      expect(await spread(1, 100)).toBe(60);
      expect(await lockedRetryAfter(OWNER_IP)).toBe(60);
    });

    it('doubles up to 15 minutes, not an hour', async () => {
      let last = 0;
      for (let i = 0; i < 6; i++) {
        last = (await spread(PHONE_FAILS_BEFORE_LOCK, i * 100))!;
        redis.advance(last);
      }
      expect(last).toBe(900);
    });

    it('its level decays after a quiet hour', async () => {
      await spread(PHONE_FAILS_BEFORE_LOCK);
      redis.advance(60);
      expect(await spread(PHONE_FAILS_BEFORE_LOCK, 100)).toBe(120);
      redis.advance(120 + 3600);
      expect(await spread(PHONE_FAILS_BEFORE_LOCK, 200)).toBe(60);
    });

    it('a successful login does not clear what others caused', async () => {
      await spread(PHONE_FAILS_BEFORE_LOCK - 1);
      await throttle.clearPair(PHONE, OWNER_IP);
      expect(await spread(1, 100)).toBe(60);
    });

    it('an unknown phone is counted the same way', async () => {
      const unknown = '+998900000000';
      for (let i = 0; i < PHONE_FAILS_BEFORE_LOCK; i++)
        await throttle.registerFailure(unknown, `192.0.2.${i}`);
      await expect(
        throttle.assertNotLocked(unknown, OWNER_IP),
      ).rejects.toMatchObject({ code: 'too_many_attempts' });
    });
  });

  it('a password reset lifts every lock of the phone, from every IP', async () => {
    await failUntilLocked(ATTACKER_IP);
    await failUntilLocked(OWNER_IP);
    for (let i = 0; i < PHONE_FAILS_BEFORE_LOCK; i++)
      await throttle.registerFailure(PHONE, `192.0.2.${i}`);

    await throttle.reset(PHONE);

    await notLocked(ATTACKER_IP);
    await notLocked(OWNER_IP);
    // levels are gone too: the next lock is the first one again
    expect(await failUntilLocked(ATTACKER_IP)).toBe(60);
  });

  it('retryAfter is the longer of the two locks', async () => {
    await failUntilLocked(ATTACKER_IP);
    redis.advance(60);
    await failUntilLocked(ATTACKER_IP); // pair: 120 s
    for (let i = 0; i < PHONE_FAILS_BEFORE_LOCK; i++)
      await throttle.registerFailure(PHONE, `192.0.2.${i}`); // phone: 60 s
    expect(await lockedRetryAfter(ATTACKER_IP)).toBe(120);
    expect(await lockedRetryAfter(OWNER_IP)).toBe(60);
  });
});
