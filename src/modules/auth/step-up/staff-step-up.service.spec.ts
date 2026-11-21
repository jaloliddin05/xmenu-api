import * as bcrypt from 'bcrypt';
import { sign } from 'jsonwebtoken';
import { makeStaffAuthDeps } from '../services/staff-auth.fake';
import { StaffStepUpService } from './staff-step-up.service';
import { StepUpTokenService } from './step-up-token.service';
import { loadStepUpSecret, stepUpEnvIssues } from './step-up.config';

const CTX = { ip: '203.0.113.5', userAgent: 'jest' };
const PASSWORD = 'owner-password-1';
const SECRET = 'step-up-spec-secret-0123456789abcdef';

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

describe('StepUpTokenService', () => {
  const tokens = new StepUpTokenService(SECRET);

  it('a token of this user and this login passes, any number of times', () => {
    const { token, expiresIn } = tokens.issue('u1', 'sid-1');
    expect(expiresIn).toBe(300);
    expect(() => tokens.assertValid(token, 'u1', 'sid-1')).not.toThrow();
    expect(() => tokens.assertValid(token, 'u1', 'sid-1')).not.toThrow();
  });

  it.each([
    ['another login', 'u1', 'sid-2'],
    ['another user', 'u2', 'sid-1'],
  ])('is refused for %s', (_name, user, sid) => {
    const { token } = tokens.issue('u1', 'sid-1');
    expect(() => tokens.assertValid(token, user, sid)).toThrow(
      expect.objectContaining({ code: 'step_up_required' }),
    );
  });

  it('is refused once expired', () => {
    jest.useFakeTimers({ now: Date.now() });
    try {
      const { token } = tokens.issue('u1', 'sid-1');
      jest.advanceTimersByTime(299_000);
      expect(() => tokens.assertValid(token, 'u1', 'sid-1')).not.toThrow();
      jest.advanceTimersByTime(2_000);
      expect(() => tokens.assertValid(token, 'u1', 'sid-1')).toThrow(
        expect.objectContaining({ code: 'step_up_required' }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['garbage', 'not-a-jwt'],
    [
      'another audience',
      sign({ sid: 'sid-1' }, SECRET, {
        subject: 'u1',
        audience: 'xmenu:customer',
        issuer: 'xmenu',
      }),
    ],
    [
      'another secret',
      sign({ sid: 'sid-1' }, 'another-secret', {
        subject: 'u1',
        audience: 'xmenu:step-up',
        issuer: 'xmenu',
      }),
    ],
    [
      'an access token of the same login',
      sign({ sub: 'u1', role: 'user', sid: 'sid-1' }, SECRET),
    ],
    [
      'alg none',
      `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(
        '{"sub":"u1","sid":"sid-1","aud":"xmenu:step-up","iss":"xmenu"}',
      ).toString('base64url')}.`,
    ],
  ])('is refused when %s', (_name, token) => {
    expect(() => tokens.assertValid(token, 'u1', 'sid-1')).toThrow(
      expect.objectContaining({ code: 'step_up_required' }),
    );
  });
});

describe('StaffStepUpService', () => {
  let deps: ReturnType<typeof makeStaffAuthDeps>;
  let tokens: StepUpTokenService;
  let service: StaffStepUpService;
  let userId: string;

  beforeEach(async () => {
    deps = makeStaffAuthDeps();
    tokens = new StepUpTokenService(SECRET);
    service = new StaffStepUpService(
      deps.db as any,
      deps.rateLimit,
      deps.events,
      tokens,
    );
    const user = await deps.db.user.create({
      data: {
        phone: '+998901234567',
        isActive: true,
        password: await bcrypt.hash(PASSWORD, 4),
      },
    });
    userId = user.id;
  });

  it('the right password gives a token bound to this login, and an audit row', async () => {
    const res = await service.issue(userId, 'sid-1', PASSWORD, CTX);
    expect(res.expiresIn).toBe(300);
    expect(() =>
      tokens.assertValid(res.stepUpToken, userId, 'sid-1'),
    ).not.toThrow();
    expect(() =>
      tokens.assertValid(res.stepUpToken, userId, 'sid-2'),
    ).toThrow();
    expect(deps.db.events.map((e) => e.type)).toEqual(['staff_step_up']);
    expect(JSON.stringify(deps.db.events)).not.toContain(PASSWORD);
  });

  it('a wrong password is wrong_password and logged', async () => {
    await expectCode(
      service.issue(userId, 'sid-1', 'nope', CTX),
      'wrong_password',
    );
    expect(deps.db.events.map((e) => e.type)).toEqual(['staff_step_up_failed']);
  });

  it('5 wrong passwords in 15 minutes: then 429 rate_limited with retryAfter, even with the right one', async () => {
    for (let i = 0; i < 5; i++)
      await expectCode(
        service.issue(userId, 'sid-1', 'nope', CTX),
        'wrong_password',
      );
    await expect(
      service.issue(userId, 'sid-1', PASSWORD, CTX),
    ).rejects.toMatchObject({ code: 'rate_limited', retryAfter: 900 });

    deps.redis.advance(901);
    await expect(
      service.issue(userId, 'sid-1', PASSWORD, CTX),
    ).resolves.toHaveProperty('stepUpToken');
  });

  it('right passwords do not count towards the limit', async () => {
    for (let i = 0; i < 8; i++)
      await service.issue(userId, 'sid-1', PASSWORD, CTX);
    for (let i = 0; i < 4; i++)
      await expectCode(
        service.issue(userId, 'sid-1', 'nope', CTX),
        'wrong_password',
      );
    await expect(
      service.issue(userId, 'sid-1', PASSWORD, CTX),
    ).resolves.toHaveProperty('stepUpToken');
  });

  it('the limit is per user and leaves the login lockout alone', async () => {
    for (let i = 0; i < 5; i++)
      await expectCode(
        service.issue(userId, 'sid-1', 'nope', CTX),
        'wrong_password',
      );
    await expect(
      deps.throttle.assertNotLocked('+998901234567'),
    ).resolves.toBeUndefined();
    const other = await deps.db.user.create({
      data: {
        phone: '+998907654321',
        isActive: true,
        password: await bcrypt.hash(PASSWORD, 4),
      },
    });
    await expect(
      service.issue(other.id, 'sid-9', PASSWORD, CTX),
    ).resolves.toHaveProperty('stepUpToken');
  });
});

describe('STAFF_STEP_UP_SECRET', () => {
  const strong = 'a'.repeat(32);
  const prod = { NODE_ENV: 'production' };

  it('is required in production', () => {
    expect(stepUpEnvIssues(prod).errors).toEqual([
      'STAFF_STEP_UP_SECRET is required when NODE_ENV=production',
    ]);
  });

  it('must be at least 32 characters in production', () => {
    expect(
      stepUpEnvIssues({ ...prod, STAFF_STEP_UP_SECRET: 'short' }).errors,
    ).toEqual([
      'STAFF_STEP_UP_SECRET must be at least 32 characters when NODE_ENV=production',
    ]);
    expect(
      stepUpEnvIssues({ ...prod, STAFF_STEP_UP_SECRET: strong }).errors,
    ).toEqual([]);
  });

  it.each([
    'JWT_ACCESS_TOKEN_SECRET',
    'JWT_CUSTOMER_ACCESS_SECRET',
    'JWT_CUSTOMER_REGISTRATION_SECRET',
    'OTP_HMAC_SECRET',
  ])('must differ from %s in production', (name) => {
    expect(
      stepUpEnvIssues({ ...prod, STAFF_STEP_UP_SECRET: strong, [name]: strong })
        .errors,
    ).toEqual([
      'STAFF_STEP_UP_SECRET must differ from the other JWT and OTP secrets',
    ]);
  });

  it('outside production a missing secret is a warning and a built-in one is used', () => {
    const issues = stepUpEnvIssues({ NODE_ENV: 'development' });
    expect(issues.errors).toEqual([]);
    expect(issues.warnings).toHaveLength(1);
    const saved = process.env.STAFF_STEP_UP_SECRET;
    const savedEnv = process.env.NODE_ENV;
    delete process.env.STAFF_STEP_UP_SECRET;
    process.env.NODE_ENV = 'test';
    try {
      expect(loadStepUpSecret()).toBeTruthy();
    } finally {
      if (saved !== undefined) process.env.STAFF_STEP_UP_SECRET = saved;
      process.env.NODE_ENV = savedEnv;
    }
  });
});
