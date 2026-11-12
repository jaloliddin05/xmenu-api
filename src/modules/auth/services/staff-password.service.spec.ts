import * as bcrypt from 'bcrypt';
import { StaffPasswordService } from './staff-password.service';
import { makeStaffAuthDeps, staffTestConfig } from './staff-auth.fake';

const CTX = { ip: '203.0.113.5', userAgent: 'jest' };
const PHONE = '+998901234567';
const OLD_PASSWORD = 'old-password-1';
const NEW_PASSWORD = 'brand-new-password';

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

describe('StaffPasswordService', () => {
  let deps: ReturnType<typeof makeStaffAuthDeps>;
  let sessions: { revokeAllForUser: jest.Mock };
  let service: StaffPasswordService;

  const addOwner = async (phone = PHONE, isActive = true) =>
    deps.db.user.create({
      data: {
        phone,
        isActive,
        password: await bcrypt.hash(OLD_PASSWORD, 4),
      },
    });

  beforeEach(() => {
    deps = makeStaffAuthDeps();
    sessions = { revokeAllForUser: jest.fn(async () => 2) };
    service = new StaffPasswordService(
      deps.db as any,
      deps.otp,
      deps.rateLimit,
      deps.events,
      deps.throttle,
      sessions as any,
      deps.sms,
      staffTestConfig,
    );
  });

  describe('forgot', () => {
    it('sends a code to a known phone and answers with the timing parameters only', async () => {
      await addOwner();
      const res = await service.forgot({ phone: PHONE }, CTX);

      expect(res).toEqual({ resendAfter: 60, codeLength: 6, expiresIn: 300 });
      expect(deps.sms.sent).toHaveLength(1);
      expect(deps.sms.sent[0].phone).toBe(PHONE);
      expect(JSON.stringify(res)).not.toContain(deps.sms.lastCode());
    });

    it('answers an unknown or deactivated phone the same way and sends nothing', async () => {
      await addOwner('+998909999999', false);
      const known = await service.forgot({ phone: '+998901111111' }, CTX);
      const inactive = await service.forgot({ phone: '+998909999999' }, CTX);

      expect(inactive).toEqual(known);
      expect(deps.sms.sent).toHaveLength(0);
    });

    it('cannot be used to enumerate phones: 20 numbers, half registered, identical answers and identical Redis footprint', async () => {
      const phones = Array.from(
        { length: 20 },
        (_, i) => `+9989012345${String(i).padStart(2, '0')}`,
      );
      for (const [i, phone] of phones.entries())
        if (i % 2 === 0) await addOwner(phone);

      const answers: unknown[] = [];
      const footprints: string[][] = [];
      for (const [i, phone] of phones.entries()) {
        // a fresh IP per phone keeps the IP counter out of the comparison
        answers.push(
          await service.forgot({ phone }, { ...CTX, ip: `198.51.100.${i}` }),
        );
        footprints.push(
          deps.redis
            .keys()
            .filter((k) => k.includes(phone))
            .map((k) => k.replace(phone, 'PHONE'))
            .sort(),
        );
      }

      expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
      expect(new Set(footprints.map((f) => JSON.stringify(f))).size).toBe(1);
      expect(deps.sms.sent).toHaveLength(10);
    });

    it('does not wait for the SMS provider, so a slow send does not show that the phone exists', async () => {
      await addOwner();
      jest
        .spyOn(deps.sms, 'send')
        .mockReturnValue(new Promise(() => undefined));
      await expect(
        Promise.race([
          service.forgot({ phone: PHONE }, CTX),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('hung')), 500),
          ),
        ]),
      ).resolves.toMatchObject({ resendAfter: 60 });
    });

    it('a failing provider does not change the answer', async () => {
      await addOwner();
      deps.sms.failNext = true;
      await expect(
        service.forgot({ phone: PHONE }, CTX),
      ).resolves.toMatchObject({
        resendAfter: 60,
      });
    });

    it('applies the pause, hourly and daily limits the same to known and unknown phones', async () => {
      await addOwner();
      for (const phone of [PHONE, '+998907777777']) {
        await service.forgot(
          { phone },
          { ...CTX, ip: `10.0.0.${phone.length}${phone.slice(-1)}` },
        );
        await expectCode(
          service.forgot({ phone }, { ...CTX, ip: '10.9.9.9' }),
          'rate_limited',
        );
        // hourly: 5 sends, pausing 60 s between them
        for (let i = 0; i < 4; i++) {
          deps.redis.advance(61);
          await service.forgot({ phone }, { ...CTX, ip: '10.9.9.8' });
        }
        deps.redis.advance(61);
        await expectCode(
          service.forgot({ phone }, { ...CTX, ip: '10.9.9.7' }),
          'rate_limited',
        );
      }
    });

    it('limits requests per IP the same for known and unknown phones', async () => {
      await addOwner();
      for (let i = 0; i < 30; i++) {
        const phone = `+9989022200${String(i).padStart(2, '0')}`;
        await service.forgot({ phone }, CTX);
      }
      await expectCode(service.forgot({ phone: PHONE }, CTX), 'rate_limited');
      await expectCode(
        service.forgot({ phone: '+998905555555' }, CTX),
        'rate_limited',
      );
    });

    it('rejects a malformed phone', async () => {
      await expectCode(
        service.forgot({ phone: '+7901' }, CTX),
        'invalid_phone',
      );
    });

    it('keeps codes, passwords and full phones out of the audit log', async () => {
      await addOwner();
      await service.forgot({ phone: PHONE }, CTX);
      const dump = JSON.stringify(deps.db.events);
      expect(dump).not.toContain(deps.sms.lastCode());
      expect(dump).not.toContain(PHONE);
      expect(deps.db.events.map((e) => e.type)).toContain(
        'staff_password_reset_requested',
      );
    });
  });

  describe('reset', () => {
    const request = async () => {
      await service.forgot({ phone: PHONE }, CTX);
      return deps.sms.lastCode();
    };

    it('sets the password, ends every login, clears the login lockout, writes the audit event', async () => {
      const user = await addOwner();
      const reset = jest.spyOn(deps.throttle, 'reset');
      const code = await request();

      await service.reset(
        { phone: PHONE, code, newPassword: NEW_PASSWORD },
        CTX,
      );

      const row = deps.db.users.find((u) => u.id === user.id)!;
      expect(await bcrypt.compare(NEW_PASSWORD, row.password!)).toBe(true);
      expect(await bcrypt.compare(OLD_PASSWORD, row.password!)).toBe(false);
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(user.id);
      expect(reset).toHaveBeenCalledWith(PHONE);
      expect(deps.db.events.map((e) => e.type)).toContain(
        'staff_password_reset',
      );
      expect(JSON.stringify(deps.db.events)).not.toContain(NEW_PASSWORD);
    });

    it('the code works once', async () => {
      await addOwner();
      const code = await request();
      await service.reset(
        { phone: PHONE, code, newPassword: NEW_PASSWORD },
        CTX,
      );
      await expectCode(
        service.reset(
          { phone: PHONE, code, newPassword: 'another-password' },
          CTX,
        ),
        'code_expired',
      );
    });

    it('a wrong code changes nothing and five misses lock the code', async () => {
      const user = await addOwner();
      const code = await request();
      const wrong = code === '000000' ? '111111' : '000000';

      for (let i = 0; i < 4; i++)
        await expectCode(
          service.reset(
            { phone: PHONE, code: wrong, newPassword: NEW_PASSWORD },
            CTX,
          ),
          'invalid_code',
        );
      await expectCode(
        service.reset(
          { phone: PHONE, code: wrong, newPassword: NEW_PASSWORD },
          CTX,
        ),
        'too_many_attempts',
      );
      // the right code no longer helps
      await expectCode(
        service.reset({ phone: PHONE, code, newPassword: NEW_PASSWORD }, CTX),
        'code_expired',
      );
      const row = deps.db.users.find((u) => u.id === user.id)!;
      expect(await bcrypt.compare(OLD_PASSWORD, row.password!)).toBe(true);
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('a malformed code is refused without spending an attempt', async () => {
      await addOwner();
      const code = await request();
      await expectCode(
        service.reset(
          { phone: PHONE, code: 'abc', newPassword: NEW_PASSWORD },
          CTX,
        ),
        'invalid_code',
      );
      await service.reset(
        { phone: PHONE, code, newPassword: NEW_PASSWORD },
        CTX,
      );
    });

    it('a code issued for registration does not reset a password', async () => {
      await addOwner();
      await deps.otp.request(
        { id: 'registration-1', brandName: 'Xmenu' },
        PHONE,
        '1.1.1.1',
        'staff',
      );
      const code = deps.sms.lastCode();
      await expectCode(
        service.reset({ phone: PHONE, code, newPassword: NEW_PASSWORD }, CTX),
        'code_expired',
      );
    });

    it('an unknown phone fails like a known one with a wrong code', async () => {
      await service.forgot({ phone: '+998908888888' }, CTX);
      await expectCode(
        service.reset(
          { phone: '+998908888888', code: '123456', newPassword: NEW_PASSWORD },
          CTX,
        ),
        'invalid_code',
      );
    });

    it('limits code guessing per phone and IP', async () => {
      await addOwner();
      await request();
      let last: unknown;
      for (let i = 0; i < 12; i++)
        last = await service
          .reset(
            { phone: PHONE, code: '000000', newPassword: NEW_PASSWORD },
            CTX,
          )
          .catch((e: { code: string }) => e.code);
      expect(last).toBe('rate_limited');
    });
  });

  describe('change', () => {
    it('needs the current password and leaves the password alone on a miss', async () => {
      const user = await addOwner();
      await expectCode(
        service.change(
          user.id,
          'sid-1',
          { currentPassword: 'nope-nope-1', newPassword: NEW_PASSWORD },
          CTX,
        ),
        'wrong_password',
      );
      const row = deps.db.users.find((u) => u.id === user.id)!;
      expect(await bcrypt.compare(OLD_PASSWORD, row.password!)).toBe(true);
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('changes the password and ends every login except the current one', async () => {
      const user = await addOwner();
      await service.change(
        user.id,
        'sid-current',
        { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
        CTX,
      );
      const row = deps.db.users.find((u) => u.id === user.id)!;
      expect(await bcrypt.compare(NEW_PASSWORD, row.password!)).toBe(true);
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
        user.id,
        'sid-current',
      );
      expect(deps.db.events.map((e) => e.type)).toContain(
        'staff_password_changed',
      );
      expect(JSON.stringify(deps.db.events)).not.toContain(OLD_PASSWORD);
    });

    it('an account without a password cannot pass the check', async () => {
      const user = await deps.db.user.create({
        data: { phone: PHONE, isActive: true },
      });
      await expectCode(
        service.change(
          user.id,
          'sid',
          { currentPassword: 'whatever-1', newPassword: NEW_PASSWORD },
          CTX,
        ),
        'wrong_password',
      );
    });

    it('limits wrong guesses of the current password', async () => {
      const user = await addOwner();
      const miss = () =>
        service
          .change(
            user.id,
            'sid',
            { currentPassword: 'nope-nope-1', newPassword: NEW_PASSWORD },
            CTX,
          )
          .catch((e: { code: string }) => e.code);
      const codes = [];
      for (let i = 0; i < 6; i++) codes.push(await miss());
      expect(codes.slice(0, 5)).toEqual(Array(5).fill('wrong_password'));
      expect(codes[5]).toBe('rate_limited');
    });
  });
});
