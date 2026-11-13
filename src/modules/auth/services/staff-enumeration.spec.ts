import { Logger } from '@nestjs/common';
import { AppException } from 'src/infra/errors/app-exception';
import { OrganizationTypeEnum } from 'src/modules/organization/models/organization.model';
import { makeStaffAuthDeps, staffTestConfig } from './staff-auth.fake';
import { ACCOUNT_EXISTS_TEXT, StaffAuthService } from './staff-auth.service';
import { StaffPasswordService } from './staff-password.service';

// bcrypt is not what this file measures; a cheap hash keeps the timing samples about the SMS and Redis work
jest.mock('src/infra/helper/auth/hash-password', () => ({
  hashPassword: async (p: string) => `hash:${p}`,
}));

const CTX = { ip: '203.0.113.5', userAgent: 'jest' };
const SIGNUP = {
  password: 'owner-password-1',
  name: 'Mant',
  type: OrganizationTypeEnum.Cafe,
  first_name: 'Aziz',
};
const KNOWN = '+998901111111';
const FREE = '+998902222222';
const phoneOf = (i: number) => `+9989012345${String(i).padStart(2, '0')}`;
const ipOf = (i: number) => `198.51.100.${i}`;

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

function setup(cfg = staffTestConfig) {
  const deps = makeStaffAuthDeps(cfg);
  const auth = new StaffAuthService(
    deps.db as any,
    deps.organizations as any,
    deps.otp,
    deps.rateLimit,
    deps.events,
    deps.throttle,
    deps.sessions as any,
    deps.r,
    cfg,
  );
  const password = new StaffPasswordService(
    deps.db as any,
    deps.otp,
    deps.rateLimit,
    deps.events,
    deps.throttle,
    { revokeAllForUser: jest.fn() } as any,
    deps.sms,
    cfg,
  );
  const addOwner = (phone: string) =>
    deps.db.user.create({ data: { phone, isActive: true, password: 'x' } });
  return { deps, auth, password, addOwner };
}

/** What a client sees of a call, without the random registrationId. */
async function outcome(p: Promise<unknown>) {
  try {
    const { registrationId: _id, ...rest } = (await p) as Record<
      string,
      unknown
    >;
    return { ok: true, ...rest };
  } catch (e) {
    const err = e as AppException;
    return { ok: false, code: err.code, retryAfter: err.retryAfter };
  }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

async function timed(fn: () => Promise<unknown>) {
  const t = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
}

describe('owner phone enumeration: registration', () => {
  it('answers a registered phone with the same body as a free one and sends a notice, not a code', async () => {
    const { deps, auth, addOwner } = setup();
    await addOwner(KNOWN);
    const known = await auth.register({ ...SIGNUP, phone: KNOWN }, CTX);
    const free = await auth.register(
      { ...SIGNUP, phone: FREE },
      { ...CTX, ip: ipOf(1) },
    );

    expect(Object.keys(known).sort()).toEqual(Object.keys(free).sort());
    expect({ ...known, registrationId: 0 }).toEqual({
      ...free,
      registrationId: 0,
    });
    expect(deps.sms.sent[0]).toEqual({
      phone: KNOWN,
      text: ACCOUNT_EXISTS_TEXT,
    });
    expect(deps.sms.sent[0].text).not.toMatch(/\d{4,}/);
    expect(deps.sms.sent[1].text).toMatch(/\d{6}/);
    expect(deps.db.users).toHaveLength(1);
  });

  it('never accepts a code for a registered phone: the same errors and the same lock as a wrong code', async () => {
    const { deps, auth, addOwner } = setup();
    await addOwner(KNOWN);
    const known = await auth.register({ ...SIGNUP, phone: KNOWN }, CTX);
    const free = await auth.register(
      { ...SIGNUP, phone: FREE },
      { ...CTX, ip: ipOf(1) },
    );
    const bad = deps.sms.lastCode() === '000000' ? '111111' : '000000';

    const attempts = async (registrationId: string) => {
      const out: unknown[] = [];
      for (let i = 0; i < staffTestConfig.otpMaxAttempts + 1; i++)
        out.push(
          await outcome(auth.checkCode({ registrationId, code: bad }, CTX)),
        );
      return out;
    };
    const onKnown = await attempts(known.registrationId);
    expect(onKnown).toEqual(await attempts(free.registrationId));
    expect(onKnown.map((o: any) => o.code)).toEqual([
      'invalid_code',
      'invalid_code',
      'invalid_code',
      'invalid_code',
      'too_many_attempts',
      'code_expired',
    ]);
    expect(deps.db.users).toHaveLength(1);
  });

  it('does not accept even the fixed development code for a registered phone', async () => {
    const { auth, addOwner } = setup({ ...staffTestConfig, otpDevMode: true });
    await addOwner(KNOWN);
    const { registrationId } = await auth.register(
      { ...SIGNUP, phone: KNOWN },
      CTX,
    );
    expect(
      await outcome(auth.checkCode({ registrationId, code: '123456' }, CTX)),
    ).toMatchObject({ ok: false, code: 'invalid_code' });
  });

  it('resend to a registered phone sends the notice again', async () => {
    const { deps, auth, addOwner } = setup();
    await addOwner(KNOWN);
    const { registrationId } = await auth.register(
      { ...SIGNUP, phone: KNOWN },
      CTX,
    );
    deps.redis.advance(61);
    await auth.resendCode(registrationId, CTX);
    expect(deps.sms.sent.map((s) => s.text)).toEqual([
      ACCOUNT_EXISTS_TEXT,
      ACCOUNT_EXISTS_TEXT,
    ]);
  });

  it('a provider failure is the same error for a registered and a free phone', async () => {
    const { deps, auth, addOwner } = setup();
    await addOwner(KNOWN);
    deps.sms.failNext = true;
    const known = await outcome(
      auth.register({ ...SIGNUP, phone: KNOWN }, CTX),
    );
    deps.sms.failNext = true;
    const free = await outcome(
      auth.register({ ...SIGNUP, phone: FREE }, { ...CTX, ip: ipOf(1) }),
    );
    expect(known).toEqual(free);
    expect(known).toMatchObject({ ok: false, code: 'sms_unavailable' });
  });

  it('20 phones, half registered: identical answers and identical Redis footprint', async () => {
    const { deps, auth, addOwner } = setup();
    const answers: string[] = [];
    const footprints: string[] = [];
    for (let i = 0; i < 20; i++) {
      const phone = phoneOf(i);
      if (i % 2 === 0) await addOwner(phone);
      answers.push(
        JSON.stringify(
          await outcome(
            auth.register({ ...SIGNUP, phone }, { ...CTX, ip: ipOf(i) }),
          ),
        ),
      );
      footprints.push(
        JSON.stringify(
          deps.redis
            .keys()
            .filter((k) => k.includes(phone))
            .map((k) =>
              k
                .replace(phone, 'PHONE')
                .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, 'ID'),
            )
            .sort(),
        ),
      );
    }
    expect(new Set(answers).size).toBe(1);
    expect(new Set(footprints).size).toBe(1);
    expect(deps.sms.sent).toHaveLength(20);
  });

  it('response time does not depend on the phone being registered (median of 20 each)', async () => {
    const { deps, auth, addOwner } = setup();
    deps.sms.delayMs = 30;
    for (let i = 0; i < 20; i++) await addOwner(phoneOf(i));
    await auth.register(
      { ...SIGNUP, phone: phoneOf(90) },
      { ...CTX, ip: ipOf(200) },
    );
    const known: number[] = [];
    const free: number[] = [];
    // interleaved, so drift hits both samples alike
    for (let i = 0; i < 20; i++) {
      known.push(
        await timed(() =>
          auth.register(
            { ...SIGNUP, phone: phoneOf(i) },
            { ...CTX, ip: ipOf(i) },
          ),
        ),
      );
      free.push(
        await timed(() =>
          auth.register(
            { ...SIGNUP, phone: phoneOf(50 + i) },
            { ...CTX, ip: ipOf(100 + i) },
          ),
        ),
      );
    }
    // the provider call takes 30 ms: a notice that was not awaited would come back about that much sooner
    expect(median(known)).toBeGreaterThanOrEqual(29);
    expect(Math.abs(median(known) - median(free))).toBeLessThan(10);
  });
});

describe('owner phone enumeration: limits do not depend on the account', () => {
  it('registration: pause, hourly limit give identical outcomes', async () => {
    const { deps, auth, addOwner } = setup();
    await addOwner(KNOWN);
    const script = async (phone: string, ip: string) => {
      const out: unknown[] = [];
      const reg = () =>
        outcome(auth.register({ ...SIGNUP, phone }, { ...CTX, ip }));
      out.push(await reg());
      out.push(await reg()); // inside the pause
      for (let i = 0; i < 4; i++) {
        deps.redis.advance(61);
        out.push(await reg());
      }
      deps.redis.advance(61);
      out.push(await reg()); // the sixth within the hour
      return out;
    };
    const known = await script(KNOWN, '10.0.0.1');
    expect(known).toEqual(await script(FREE, '10.0.0.2'));
    expect(known[1]).toMatchObject({ ok: false, code: 'rate_limited' });
    expect(known[6]).toMatchObject({ ok: false, code: 'rate_limited' });
  });

  it('password recovery: the same outcomes for a registered and an unknown phone', async () => {
    const { deps, password, addOwner } = setup();
    await addOwner(KNOWN);
    const script = async (phone: string, ip: string) => {
      const out: unknown[] = [];
      const forgot = () => outcome(password.forgot({ phone }, { ...CTX, ip }));
      out.push(await forgot());
      out.push(await forgot());
      for (let i = 0; i < 4; i++) {
        deps.redis.advance(61);
        out.push(await forgot());
      }
      deps.redis.advance(61);
      out.push(await forgot());
      return out;
    };
    const known = await script(KNOWN, '10.0.0.1');
    expect(known).toEqual(await script(FREE, '10.0.0.2'));
    expect(known[1]).toMatchObject({ ok: false, code: 'rate_limited' });
  });

  it('a sign-up code does not put a phone on pause for recovery, registered or not', async () => {
    const { auth, password, addOwner } = setup();
    await addOwner(KNOWN);
    for (const [phone, ip] of [
      [KNOWN, '10.0.0.1'],
      [FREE, '10.0.0.2'],
    ]) {
      await auth.register({ ...SIGNUP, phone }, { ...CTX, ip });
      await expect(
        password.forgot({ phone }, { ...CTX, ip }),
      ).resolves.toMatchObject({ resendAfter: 60 });
    }
  });

  it('password recovery response time does not depend on the phone (median of 20 each)', async () => {
    const { deps, password, addOwner } = setup();
    deps.sms.delayMs = 30;
    for (let i = 0; i < 20; i++) await addOwner(phoneOf(i));
    await password.forgot({ phone: phoneOf(90) }, { ...CTX, ip: ipOf(200) });
    const known: number[] = [];
    const free: number[] = [];
    for (let i = 0; i < 20; i++) {
      known.push(
        await timed(() =>
          password.forgot({ phone: phoneOf(i) }, { ...CTX, ip: ipOf(i) }),
        ),
      );
      free.push(
        await timed(() =>
          password.forgot(
            { phone: phoneOf(50 + i) },
            { ...CTX, ip: ipOf(100 + i) },
          ),
        ),
      );
    }
    expect(Math.abs(median(known) - median(free))).toBeLessThan(10);
  });
});
