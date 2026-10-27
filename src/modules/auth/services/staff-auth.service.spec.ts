import * as bcrypt from 'bcrypt';
import { Logger } from '@nestjs/common';
import { CustomerAuthException } from '../errors/customer-auth.exception';
import { OrganizationTypeEnum } from 'src/modules/organization/models/organization.model';
import { makeStaffAuthDeps, staffTestConfig } from './staff-auth.fake';
import { PENDING_REGISTRATION_TTL_SECONDS, StaffAuthService } from './staff-auth.service';

const PHONE = '+998901234567';
const CTX = { ip: '10.0.0.1', userAgent: 'jest' };
const SIGNUP = {
  phone: PHONE,
  password: 'owner-password-1',
  name: 'Mant',
  type: OrganizationTypeEnum.Cafe,
  first_name: 'Aziz',
  last_name: 'Karimov',
};

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(CustomerAuthException);
  expect(err.code).toBe(code);
  return err as CustomerAuthException;
}

function wrong(code: string) {
  return code === '000000' ? '111111' : '000000';
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

describe('StaffAuthService (signup)', () => {
  let deps: ReturnType<typeof makeStaffAuthDeps>;
  let service: StaffAuthService;

  beforeEach(() => {
    deps = makeStaffAuthDeps();
    service = new StaffAuthService(
      deps.db as any,
      deps.organizations as any,
      deps.otp,
      deps.rateLimit,
      deps.events,
      deps.jwt as any,
      deps.r,
      staffTestConfig,
    );
  });

  describe('register', () => {
    it('writes nothing to the database and never returns the code', async () => {
      const res = await service.register(SIGNUP, CTX);

      expect(res).toEqual({
        registrationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        resendAfter: 60,
        codeLength: 6,
        expiresIn: 300,
      });
      expect(deps.db.users).toHaveLength(0);
      expect(deps.db.orgs).toHaveLength(0);
      expect(JSON.stringify(res)).not.toContain(deps.sms.lastCode());
      expect(deps.sms.sent[0].phone).toBe(PHONE);
    });

    it('keeps only a bcrypt hash of the password in Redis', async () => {
      const { registrationId } = await service.register(SIGNUP, CTX);
      const raw = (await deps.redis.get(`staff:reg:${registrationId}`))!;

      expect(raw).not.toContain(SIGNUP.password);
      const pending = JSON.parse(raw);
      expect(await bcrypt.compare(SIGNUP.password, pending.passwordHash)).toBe(true);
      expect(await deps.redis.ttl(`staff:reg:${registrationId}`)).toBe(PENDING_REGISTRATION_TTL_SECONDS);
    });

    it('refuses a phone that already has an active owner', async () => {
      await deps.db.user.create({ data: { phone: PHONE, isActive: true } });
      await expectCode(service.register(SIGNUP, CTX), 'phone_taken');
      expect(deps.sms.sent).toHaveLength(0);
    });

    it('rejects a malformed phone', async () => {
      await expectCode(service.register({ ...SIGNUP, phone: '+7901' }, CTX), 'invalid_phone');
    });

    it('drops the pending signup when the SMS provider fails', async () => {
      deps.sms.failNext = true;
      await expectCode(service.register(SIGNUP, CTX), 'sms_unavailable');
      expect(deps.redis.keys().filter((k) => k.startsWith('staff:reg:') && !k.includes(':rl:'))).toEqual([]);
      expect(deps.db.events.map((e) => e.type)).toContain('staff_otp_send_failed');
    });

    it('limits signups per IP', async () => {
      for (let i = 0; i < 10; i++) {
        await service.register({ ...SIGNUP, phone: `+9989012345${String(i).padStart(2, '0')}` }, CTX);
      }
      await expectCode(service.register({ ...SIGNUP, phone: '+998909999999' }, CTX), 'rate_limited');
    });
  });

  describe('check-code', () => {
    it('creates an active owner and venue only after the right code', async () => {
      const { registrationId } = await service.register(SIGNUP, CTX);
      const res = await service.checkCode({ registrationId, code: deps.sms.lastCode() }, CTX);

      expect(deps.db.users).toHaveLength(1);
      const user = deps.db.users[0];
      expect(user).toMatchObject({ phone: PHONE, first_name: 'Aziz', last_name: 'Karimov', isActive: true });
      expect(await bcrypt.compare(SIGNUP.password, user.password!)).toBe(true);
      expect(deps.db.orgs[0]).toMatchObject({ owner_id: user.id, name: 'Mant', type: 'cafe', is_active: true });

      expect(res.success).toBe(true);
      expect(res.accessToken).toBe(`access:${user.id}`);
      expect(res.refreshToken).toBe(`refresh:${user.id}`);
      expect(res.user).not.toHaveProperty('password');
      expect(res.user.organization?.id).toBe(deps.db.orgs[0].id);
      expect(deps.db.events.map((e) => e.type)).toContain('staff_registered');
    });

    it('rejects a wrong code without creating anything, then locks', async () => {
      const { registrationId } = await service.register(SIGNUP, CTX);
      const bad = wrong(deps.sms.lastCode());

      for (let i = 0; i < staffTestConfig.otpMaxAttempts - 1; i++) {
        await expectCode(service.checkCode({ registrationId, code: bad }, CTX), 'invalid_code');
      }
      await expectCode(service.checkCode({ registrationId, code: bad }, CTX), 'too_many_attempts');
      expect(deps.db.users).toHaveLength(0);
      expect(deps.db.events.map((e) => e.type)).toEqual(
        expect.arrayContaining(['staff_otp_failed', 'staff_otp_locked']),
      );
    });

    it('does not spend an attempt on a malformed code', async () => {
      const { registrationId } = await service.register(SIGNUP, CTX);
      for (let i = 0; i < 10; i++) {
        await expectCode(service.checkCode({ registrationId, code: '12' }, CTX), 'invalid_code');
      }
      await expect(
        service.checkCode({ registrationId, code: deps.sms.lastCode() }, CTX),
      ).resolves.toMatchObject({ success: true });
    });

    it('rejects an expired code', async () => {
      const { registrationId } = await service.register(SIGNUP, CTX);
      const code = deps.sms.lastCode();
      deps.redis.advance(staffTestConfig.otpTtlSeconds);
      await expectCode(service.checkCode({ registrationId, code }, CTX), 'code_expired');
      expect(deps.db.users).toHaveLength(0);
    });

    it('rejects an expired or unknown signup', async () => {
      const { registrationId } = await service.register(SIGNUP, CTX);
      const code = deps.sms.lastCode();
      deps.redis.advance(PENDING_REGISTRATION_TTL_SECONDS);
      await expectCode(service.checkCode({ registrationId, code }, CTX), 'registration_expired');
      await expectCode(
        service.checkCode({ registrationId: '00000000-0000-4000-8000-000000000000', code }, CTX),
        'registration_expired',
      );
    });

    it('works once', async () => {
      const { registrationId } = await service.register(SIGNUP, CTX);
      const code = deps.sms.lastCode();
      await service.checkCode({ registrationId, code }, CTX);
      await expectCode(service.checkCode({ registrationId, code }, CTX), 'registration_expired');
      expect(deps.db.users).toHaveLength(1);
    });

    it('does not let a second signup for the same phone take over the first one', async () => {
      const first = await service.register(SIGNUP, CTX);
      const firstCode = deps.sms.lastCode();

      deps.redis.advance(60);
      await service.register({ ...SIGNUP, password: 'attacker-password', name: 'Evil' }, { ...CTX, ip: '10.6.6.6' });

      await service.checkCode({ registrationId: first.registrationId, code: firstCode }, CTX);
      expect(await bcrypt.compare(SIGNUP.password, deps.db.users[0].password!)).toBe(true);
      expect(deps.db.orgs[0].name).toBe('Mant');
    });

    it('refuses if the phone got registered meanwhile', async () => {
      const { registrationId } = await service.register(SIGNUP, CTX);
      await deps.db.user.create({ data: { phone: PHONE, isActive: true } });
      await expectCode(
        service.checkCode({ registrationId, code: deps.sms.lastCode() }, CTX),
        'phone_taken',
      );
      expect(deps.db.users).toHaveLength(1);
    });

    it('takes over an unconfirmed row left by the old signup flow', async () => {
      const legacy = await deps.db.user.create({ data: { phone: PHONE, first_name: 'Old', isActive: false } });
      await deps.organizations.create({ name: 'Old name', type: 'other' }, legacy.id);

      const { registrationId } = await service.register(SIGNUP, CTX);
      await service.checkCode({ registrationId, code: deps.sms.lastCode() }, CTX);

      expect(deps.db.users).toHaveLength(1);
      expect(deps.db.users[0]).toMatchObject({ id: legacy.id, first_name: 'Aziz', isActive: true });
      expect(deps.db.orgs).toHaveLength(1);
      expect(deps.db.orgs[0]).toMatchObject({ owner_id: legacy.id, name: 'Mant', is_active: true });
    });
  });

  describe('resend-code', () => {
    it('respects the cooldown and replaces the old code', async () => {
      const { registrationId } = await service.register(SIGNUP, CTX);
      const oldCode = deps.sms.lastCode();

      const limited = await expectCode(service.resendCode(registrationId, CTX), 'rate_limited');
      expect(limited.retryAfter).toBe(60);

      deps.redis.advance(60);
      await expect(service.resendCode(registrationId, CTX)).resolves.toEqual({ resendAfter: 60, expiresIn: 300 });
      const newCode = deps.sms.lastCode();

      if (newCode !== oldCode) {
        await expectCode(service.checkCode({ registrationId, code: oldCode }, CTX), 'invalid_code');
      }
      await expect(service.checkCode({ registrationId, code: newCode }, CTX)).resolves.toMatchObject({
        success: true,
      });
    });

    it('extends the pending signup', async () => {
      const { registrationId } = await service.register(SIGNUP, CTX);
      deps.redis.advance(PENDING_REGISTRATION_TTL_SECONDS - 10);
      await service.resendCode(registrationId, CTX);
      expect(await deps.redis.ttl(`staff:reg:${registrationId}`)).toBe(PENDING_REGISTRATION_TTL_SECONDS);
    });

    it('refuses an unknown signup', async () => {
      await expectCode(
        service.resendCode('00000000-0000-4000-8000-000000000000', CTX),
        'registration_expired',
      );
      expect(deps.sms.sent).toHaveLength(0);
    });
  });

  it('never writes codes, passwords or full phones to the audit log', async () => {
    const { registrationId } = await service.register(SIGNUP, CTX);
    const code = deps.sms.lastCode();
    await service.checkCode({ registrationId, code: wrong(code) }, CTX).catch(() => undefined);
    await service.checkCode({ registrationId, code }, CTX);

    const dump = JSON.stringify(deps.db.events);
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(SIGNUP.password);
    expect(dump).not.toContain(PHONE);
  });
});
