import { Logger } from '@nestjs/common';
import { makeStaffAuthDeps } from 'src/modules/auth/services/staff-auth.fake';
import { INVITATION_TTL_MS } from './domain/staff-member';
import { INVITE_ORG_HOURLY_LIMIT, StaffService } from './staff.service';

const CTX = { ip: '10.0.0.1', userAgent: 'jest' };
const OWNER_PHONE = '+998901234567';
const OP_PHONE = '+998907654321';
const HOUR = 3600 * 1000;

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

describe('StaffService', () => {
  let deps: ReturnType<typeof makeStaffAuthDeps>;
  let sessions: { revokeAllForUser: jest.Mock };
  let service: StaffService;
  let orgId: string;
  let ownerId: string;

  beforeEach(async () => {
    deps = makeStaffAuthDeps();
    sessions = { revokeAllForUser: jest.fn(async () => 2) };
    service = new StaffService(
      deps.db as any,
      deps.rateLimit,
      deps.events,
      sessions as any,
    );
    const owner = await deps.db.user.create({
      data: { phone: OWNER_PHONE, first_name: 'Aziz', isActive: true },
    });
    ownerId = owner.id;
    orgId = (
      await deps.organizations.create({ name: 'Mant', type: 'cafe' }, owner)
    ).id;
  });

  const invite = (phone = OP_PHONE, org = orgId) =>
    service.invite(org, ownerId, { phone, first_name: 'Dilshod' }, CTX);

  describe('invite', () => {
    it('creates an open invitation for 72 hours and writes the audit event', async () => {
      const before = Date.now();
      const member = await invite();

      expect(member).toMatchObject({
        role: 'operator',
        status: 'invited',
        phone: OP_PHONE,
        firstName: 'Dilshod',
        lastName: null,
        activatedAt: null,
      });
      const expires = member.inviteExpiresAt!.getTime() - before;
      expect(expires).toBeGreaterThanOrEqual(INVITATION_TTL_MS - 1000);
      expect(expires).toBeLessThanOrEqual(INVITATION_TTL_MS + 1000);
      expect(deps.db.events.map((e) => e.type)).toContain('staff_invited');
      expect(JSON.stringify(deps.db.events)).not.toContain(OP_PHONE);
    });

    it('inviting the same phone again restarts the invitation instead of adding a row', async () => {
      const first = await invite();
      deps.db.members.find((m) => m.id === first.id)!.invite_expires_at =
        new Date(Date.now() - HOUR);
      expect((await service.list(orgId))[1].status).toBe('expired');

      const again = await invite();
      expect(again.id).toBe(first.id);
      expect(again.status).toBe('invited');
      expect(deps.db.members.filter((m) => m.phone === OP_PHONE)).toHaveLength(
        1,
      );
    });

    it('reopens a cancelled invitation', async () => {
      const first = await invite();
      await service.disable(orgId, first.id, CTX);
      const again = await invite();
      expect(again).toMatchObject({
        id: first.id,
        status: 'invited',
        disabledAt: null,
      });
    });

    it.each([
      ['the owner of this venue', OWNER_PHONE],
      ['a user of another venue', '+998905555555'],
    ])('a phone with an account is taken: %s', async (_name, phone) => {
      if (phone !== OWNER_PHONE)
        await deps.db.user.create({ data: { phone, isActive: true } });
      await expect(invite(phone)).rejects.toMatchObject({
        code: 'phone_taken',
      });
    });

    it('a phone with an open invitation of another venue is taken; an expired one is not', async () => {
      const other = await deps.db.user.create({
        data: { phone: '+998903333333', isActive: true },
      });
      const otherOrg = (
        await deps.organizations.create({ name: 'Other', type: 'cafe' }, other)
      ).id;
      const elsewhere = await invite(OP_PHONE, otherOrg);
      await expect(invite()).rejects.toMatchObject({ code: 'phone_taken' });

      deps.db.members.find((m) => m.id === elsewhere.id)!.invite_expires_at =
        new Date(Date.now() - HOUR);
      await expect(invite()).resolves.toMatchObject({ status: 'invited' });
    });

    it('rejects an invalid phone', async () => {
      await expect(invite('12345')).rejects.toMatchObject({
        code: 'invalid_phone',
      });
    });

    it(`limits a venue to ${INVITE_ORG_HOURLY_LIMIT} invitations an hour`, async () => {
      for (let i = 0; i < INVITE_ORG_HOURLY_LIMIT; i++)
        await invite(`+9989011100${String(i).padStart(2, '0')}`);
      await expect(invite('+998901119999')).rejects.toMatchObject({
        code: 'rate_limited',
      });
    });
  });

  describe('list', () => {
    it('the owner first, then the operators in the order they were added', async () => {
      await invite('+998901000001');
      await invite('+998901000002');
      const list = await service.list(orgId);
      expect(list.map((m) => [m.role, m.phone])).toEqual([
        ['owner', OWNER_PHONE],
        ['operator', '+998901000001'],
        ['operator', '+998901000002'],
      ]);
      expect(list[0]).toMatchObject({
        status: 'active',
        inviteExpiresAt: null,
      });
    });

    it('shows only this venue', async () => {
      const other = await deps.db.user.create({
        data: { phone: '+998903333333', isActive: true },
      });
      await deps.organizations.create({ name: 'Other', type: 'cafe' }, other);
      expect(await service.list(orgId)).toHaveLength(1);
    });
  });

  describe('disable', () => {
    async function activeOperator() {
      const member = await invite();
      const user = await deps.db.user.create({
        data: { phone: OP_PHONE, isActive: true },
      });
      Object.assign(deps.db.members.find((m) => m.id === member.id)!, {
        user_id: user.id,
        status: 'active',
      });
      return { member, user };
    }

    it('switches the account off and ends every login at once', async () => {
      const { member, user } = await activeOperator();
      await service.disable(orgId, member.id, CTX);

      expect(deps.db.users.find((u) => u.id === user.id)!.isActive).toBe(false);
      expect(deps.db.members.find((m) => m.id === member.id)).toMatchObject({
        status: 'disabled',
      });
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(user.id);
      expect(deps.db.events.map((e) => e.type)).toContain('staff_disabled');
    });

    it('cancels an invitation without touching sessions', async () => {
      const member = await invite();
      await service.disable(orgId, member.id, CTX);
      expect((await service.list(orgId))[1].status).toBe('disabled');
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('is idempotent', async () => {
      const { member } = await activeOperator();
      await service.disable(orgId, member.id, CTX);
      await service.disable(orgId, member.id, CTX);
      expect(sessions.revokeAllForUser).toHaveBeenCalledTimes(1);
    });

    it('the owner cannot be disabled', async () => {
      const owner = deps.db.ownerOf(orgId)!;
      await expect(service.disable(orgId, owner.id, CTX)).rejects.toMatchObject(
        {
          code: 'forbidden',
        },
      );
      expect(deps.db.users.find((u) => u.id === ownerId)!.isActive).toBe(true);
    });

    it("another venue's member looks missing", async () => {
      const { member } = await activeOperator();
      await expect(
        service.disable('org-other', member.id, CTX),
      ).rejects.toMatchObject({ code: 'not_found' });
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });
  });
});
