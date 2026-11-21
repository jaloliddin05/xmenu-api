import type Redis from 'ioredis';
import { FakeRedis } from 'src/infra/redis/redis.fake';
import { AppException } from 'src/infra/errors/app-exception';
import type { OpsNotifierService } from 'src/modules/order/notifications/ops-notifier.service';
import {
  BudgetedSmsProvider,
  secondsToTashkentMidnight,
  SmsBudgetService,
  tashkentDay,
} from './sms-budget.service';

// 2026-11-21 12:00 in Tashkent (UTC+5)
const NOON = Date.UTC(2026, 10, 21, 7, 0, 0);

describe('Tashkent day', () => {
  it('turns at 19:00 UTC', () => {
    expect(tashkentDay(Date.UTC(2026, 10, 21, 18, 59, 59))).toBe('2026-11-21');
    expect(tashkentDay(Date.UTC(2026, 10, 21, 19, 0, 0))).toBe('2026-11-22');
  });

  it('counts the seconds to the next midnight there', () => {
    expect(secondsToTashkentMidnight(NOON)).toBe(12 * 3600);
    expect(secondsToTashkentMidnight(Date.UTC(2026, 10, 21, 18, 59, 59))).toBe(
      1,
    );
    expect(secondsToTashkentMidnight(Date.UTC(2026, 10, 21, 19, 0, 0))).toBe(
      86400,
    );
  });
});

describe('SmsBudgetService', () => {
  const env = { ...process.env };
  let redis: FakeRedis;
  let alerts: string[];
  let budget: SmsBudgetService;
  let now: number;

  beforeEach(() => {
    process.env = {
      ...env,
      SMS_DAILY_LIMIT_PLATFORM: '10',
      SMS_DAILY_LIMIT_TENANT: '5',
    };
    redis = new FakeRedis();
    alerts = [];
    budget = new SmsBudgetService(
      redis as unknown as Redis,
      {
        alert: async (text: string) => {
          alerts.push(text);
        },
      } as unknown as OpsNotifierService,
    );
    now = NOON;
    budget.now = () => now;
  });
  afterAll(() => {
    process.env = env;
  });

  async function refusal(p: Promise<unknown>): Promise<AppException> {
    const err = await p.then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(AppException);
    expect(err.code).toBe('sms_limit');
    expect(err.getStatus()).toBe(429);
    return err;
  }

  const send = async (n: number, tenantId?: string) => {
    for (let i = 0; i < n; i++) await budget.consume(tenantId);
  };

  it('no ceilings set: nothing is counted or refused', async () => {
    delete process.env.SMS_DAILY_LIMIT_PLATFORM;
    delete process.env.SMS_DAILY_LIMIT_TENANT;
    await send(50, 'venue-a');
    expect(redis.keys()).toEqual([]);
    expect(alerts).toEqual([]);
  });

  it('platform: one alert at 80%, then a refusal over the ceiling with one more alert', async () => {
    await send(7);
    expect(alerts).toEqual([]);
    await send(1);
    expect(alerts).toEqual([expect.stringContaining('8 из 10')]);
    await send(2);
    expect(alerts).toHaveLength(1);

    const err = await refusal(budget.consume());
    expect(err.retryAfter).toBe(12 * 3600);
    await refusal(budget.consume());
    expect(alerts).toHaveLength(2);
    expect(alerts[1]).toContain('исчерпан');
    // a refused SMS is not counted
    expect(await redis.get('sms:budget:platform:2026-11-21')).toBe('10');
  });

  it('owner SMS (no venue) count towards the platform ceiling only', async () => {
    await send(10);
    expect(redis.keys().filter((k) => k.includes(':tenant:'))).toEqual([]);
    await refusal(budget.consume('venue-a'));
  });

  it('venue: its own ceiling, the other venue goes on, the platform counts both', async () => {
    await send(5, 'venue-a');
    expect(alerts).toEqual([expect.stringContaining('заведения venue-a')]);
    await refusal(budget.consume('venue-a'));
    expect(alerts).toHaveLength(2);
    await send(3, 'venue-b');
    expect(await redis.get('sms:budget:platform:2026-11-21')).toBe('8');
  });

  it('a venue refusal gives the platform SMS back', async () => {
    await send(5, 'venue-a');
    await refusal(budget.consume('venue-a'));
    expect(await redis.get('sms:budget:platform:2026-11-21')).toBe('5');
  });

  it('a new Tashkent day starts from zero, alerts included', async () => {
    await send(10);
    await refusal(budget.consume());
    now = Date.UTC(2026, 10, 21, 19, 0, 0);
    await send(8);
    expect(alerts).toHaveLength(3);
    expect(alerts[2]).toContain('8 из 10');
  });

  it('assertAvailable refuses a used-up ceiling and takes nothing', async () => {
    await budget.assertAvailable();
    expect(redis.keys()).toEqual([]);
    await send(10);
    await refusal(budget.assertAvailable());
  });

  it('a failed alert does not change the decision', async () => {
    budget = new SmsBudgetService(
      redis as unknown as Redis,
      {
        alert: async () => {
          throw new Error('telegram down');
        },
      } as unknown as OpsNotifierService,
    );
    budget.now = () => now;
    await send(10);
    await refusal(budget.consume());
  });

  it('BudgetedSmsProvider: a refused SMS never reaches the provider', async () => {
    const sent: string[] = [];
    const provider = new BudgetedSmsProvider(
      {
        send: async (phone: string) => {
          sent.push(phone);
        },
      },
      budget,
    );
    for (let i = 0; i < 5; i++)
      await provider.send('+998901234567', 'code', { tenantId: 'venue-a' });
    await refusal(
      provider.send('+998901234567', 'code', { tenantId: 'venue-a' }),
    );
    expect(sent).toHaveLength(5);
  });
});
