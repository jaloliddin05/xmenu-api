import * as bcrypt from 'bcrypt';
import { Logger } from '@nestjs/common';
import { makeStaffAuthDeps, staffTestConfig } from './staff-auth.fake';
import { StaffInvitationService } from './staff-invitation.service';

const CTX = { ip: '10.0.0.1', userAgent: 'jest' };
const OP_PHONE = '+998907654321';
const PASSWORD = 'operator-password-1';
const HOUR = 3600 * 1000;

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

describe('StaffInvitationService', () => {
  let deps: ReturnType<typeof makeStaffAuthDeps>;
  let service: StaffInvitationService;
  let orgId: string;

  beforeEach(async () => {
    deps = makeStaffAuthDeps();
    service = new StaffInvitationService(
      deps.db as any,
      deps.otp,
      deps.rateLimit,
      deps.events,
      deps.sessions as any,
      deps.sms,
      staffTestConfig,
      deps.smsBudget,
    );
    const owner = await deps.db.user.create({
      data: { phone: '+998901234567', isActive: true },
    });
    orgId = (
      await deps.organizations.create({ name: 'Mant', type: 'cafe' }, owner)
    ).id;
  });

  const invitation = (over: Record<string, unknown> = {}) =>
    deps.db.organization_member.create({
      data: {
        organization_id: orgId,
        role: 'operator',
        status: 'invited',
        phone: OP_PHONE,
        first_name: 'Dilshod',
        last_name: 'Karimov',
        invite_expires_at: new Date(Date.now() + HOUR),
        ...over,
      },
    });

  const requestCode = async (phone = OP_PHONE) => {
    await service.requestCode({ phone }, CTX);
    // The SMS is not awaited by the service
    await new Promise((r) => setImmediate(r));
  };

  const accept = (code: string, phone = OP_PHONE) =>
    service.accept({ phone, code, password: PASSWORD }, CTX);

  describe('code', () => {
    it('sends a code to an invited phone', async () => {
      await invitation();
      await requestCode();
      expect(deps.sms.sent).toHaveLength(1);
      expect(deps.sms.sent[0].phone).toBe(OP_PHONE);
    });

    it.each([
      ['no invitation', async () => undefined],
      [
        'an expired invitation',
        () => invitation({ invite_expires_at: new Date(Date.now() - HOUR) }),
      ],
      ['a cancelled invitation', () => invitation({ status: 'disabled' })],
      [
        'a phone that already has an account',
        async () => {
          await invitation();
          await deps.db.user.create({ data: { phone: OP_PHONE } });
        },
      ],
    ])('%s: the same answer and nothing is sent', async (_name, seed) => {
      const reference = await service.requestCode(
        { phone: '+998900000000' },
        { ...CTX, ip: '10.0.0.9' },
      );
      await seed();
      const res = await service.requestCode({ phone: OP_PHONE }, CTX);
      await new Promise((r) => setImmediate(r));
      expect(res).toEqual(reference);
      expect(deps.sms.sent).toHaveLength(0);
    });
  });

  describe('accept', () => {
    it('creates the operator, activates the invitation and signs in', async () => {
      const member = await invitation();
      await requestCode();
      const res = await accept(deps.sms.lastCode());

      const user = deps.db.users.find((u) => u.phone === OP_PHONE)!;
      expect(user).toMatchObject({
        first_name: 'Dilshod',
        last_name: 'Karimov',
        isActive: true,
      });
      expect(await bcrypt.compare(PASSWORD, user.password!)).toBe(true);
      expect(deps.db.members.find((m) => m.id === member.id)).toMatchObject({
        user_id: user.id,
        status: 'active',
        invite_expires_at: null,
      });
      expect(res).toMatchObject({
        success: true,
        accessToken: `access:${user.id}`,
        user: { role: 'operator', organization: { id: orgId } },
      });
      expect(res.user).not.toHaveProperty('password');
      expect(deps.db.events.map((e) => e.type)).toContain(
        'staff_invite_accepted',
      );
      expect(JSON.stringify(deps.db.events)).not.toContain(PASSWORD);
    });

    it('a wrong code creates nothing', async () => {
      await invitation();
      await requestCode();
      const code = deps.sms.lastCode();
      await expect(
        accept(code === '000000' ? '111111' : '000000'),
      ).rejects.toMatchObject({ code: 'invalid_code' });
      expect(deps.db.users.some((u) => u.phone === OP_PHONE)).toBe(false);
    });

    it('the code works once', async () => {
      await invitation();
      await requestCode();
      const code = deps.sms.lastCode();
      await accept(code);
      await expect(accept(code)).rejects.toMatchObject({
        code: 'code_expired',
      });
      expect(deps.db.users.filter((u) => u.phone === OP_PHONE)).toHaveLength(1);
    });

    it('an invitation cancelled after the code was sent is not accepted', async () => {
      const member = await invitation();
      await requestCode();
      deps.db.members.find((m) => m.id === member.id)!.status = 'disabled';
      await expect(accept(deps.sms.lastCode())).rejects.toMatchObject({
        code: 'code_expired',
      });
      expect(deps.db.users.some((u) => u.phone === OP_PHONE)).toBe(false);
    });

    it('a phone that got an account meanwhile is not accepted, and nothing is half-written', async () => {
      const member = await invitation();
      await requestCode();
      await deps.db.user.create({ data: { phone: OP_PHONE, isActive: true } });
      await expect(accept(deps.sms.lastCode())).rejects.toMatchObject({
        code: 'code_expired',
      });
      expect(deps.db.members.find((m) => m.id === member.id)!.status).toBe(
        'invited',
      );
    });

    it('a malformed code does not spend an attempt', async () => {
      await invitation();
      await expect(accept('12')).rejects.toMatchObject({
        code: 'invalid_code',
      });
    });
  });
});
