import type Redis from 'ioredis';
import { FakeRedis } from 'src/infra/redis/redis.fake';
import { CustomerAuthException } from '../errors/customer-auth.exception';
import {
  LOGIN_FAILS_BEFORE_LOCK,
  StaffLoginThrottleService,
} from './staff-login-throttle.service';

const PHONE = '+998901234567';

describe('StaffLoginThrottleService', () => {
  let redis: FakeRedis;
  let throttle: StaffLoginThrottleService;

  beforeEach(() => {
    redis = new FakeRedis();
    throttle = new StaffLoginThrottleService(redis as unknown as Redis);
  });

  async function failUntilLocked(): Promise<number> {
    let lockedFor: number | null = null;
    for (let i = 0; i < LOGIN_FAILS_BEFORE_LOCK; i++) {
      await throttle.assertNotLocked(PHONE);
      lockedFor = await throttle.registerFailure(PHONE);
      if (i < LOGIN_FAILS_BEFORE_LOCK - 1) expect(lockedFor).toBeNull();
    }
    return lockedFor!;
  }

  async function lockedRetryAfter(): Promise<number> {
    const err = await throttle.assertNotLocked(PHONE).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(CustomerAuthException);
    expect(err.code).toBe('too_many_attempts');
    expect(err.getStatus()).toBe(429);
    return err.retryAfter;
  }

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
    for (let i = 0; i < 10; i++) {
      last = await failUntilLocked();
      redis.advance(last);
    }
    expect(last).toBe(3600);
  });

  it('forgets failures outside the 15-minute window', async () => {
    for (let i = 0; i < LOGIN_FAILS_BEFORE_LOCK - 1; i++)
      await throttle.registerFailure(PHONE);
    redis.advance(900);
    expect(await throttle.registerFailure(PHONE)).toBeNull();
  });

  it('resets everything after a successful login', async () => {
    await failUntilLocked();
    redis.advance(60);
    await throttle.reset(PHONE);
    // Back to level 1
    expect(await failUntilLocked()).toBe(60);
  });

  it('decays the escalation level after a quiet day', async () => {
    await failUntilLocked();
    redis.advance(60);
    await failUntilLocked();
    redis.advance(86400);
    expect(await failUntilLocked()).toBe(60);
  });

  it('keeps phones independent', async () => {
    await failUntilLocked();
    await expect(
      throttle.assertNotLocked('+998909999999'),
    ).resolves.toBeUndefined();
  });
});
