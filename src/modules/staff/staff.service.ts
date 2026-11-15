import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { AppException } from 'src/infra/errors/app-exception';
import { isValidPhone } from 'src/infra/helper/auth/customer-validators';
import type { RequestCtx } from 'src/modules/auth/services/customer-auth-event.service';
import { RateLimitService } from 'src/modules/auth/services/rate-limit.service';
import { StaffAuthEventService } from 'src/modules/auth/services/staff-auth-event.service';
import { StaffSessionService } from 'src/modules/auth/services/staff-session.service';
import { openInvitationWhere } from 'src/modules/auth/services/staff-invitation.service';
import type { InviteStaffDto } from './dto/staff-member.dto';
import {
  byRoleThenAdded,
  INVITATION_TTL_MS,
  toStaffMember,
} from './domain/staff-member';

/** Invitations one venue may send per hour. */
export const INVITE_ORG_HOURLY_LIMIT = 20;

/**
 * The owner's side of staff accounts: the list, operator invitations and disabling. The operator
 * accepts an invitation through StaffInvitationService (POST /auth/invitation/*).
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly events: StaffAuthEventService,
    private readonly sessions: StaffSessionService,
  ) {}

  async list(organizationId: string) {
    const rows = await this.prisma.organization_member.findMany({
      where: { organization_id: organizationId },
    });
    const now = new Date();
    return rows.sort(byRoleThenAdded).map((r) => toStaffMember(r, now));
  }

  /**
   * Invites an operator by phone. Inviting a phone this venue already invited (open, expired or
   * cancelled) restarts the invitation. A phone with an account, or with an open invitation of another
   * venue, is taken: one venue per staff user for now.
   */
  async invite(
    organizationId: string,
    invitedById: string,
    dto: InviteStaffDto,
    ctx: RequestCtx,
  ) {
    if (!isValidPhone(dto.phone)) throw new AppException('invalid_phone');
    await this.rateLimit.hit([
      {
        key: `staff:invite:rl:org:${organizationId}`,
        limit: INVITE_ORG_HOURLY_LIMIT,
        ttlSeconds: 3600,
      },
    ]);

    const phone = dto.phone;
    const now = new Date();
    const data = {
      role: 'operator' as const,
      status: 'invited' as const,
      first_name: dto.first_name,
      last_name: dto.last_name || null,
      invited_by_id: invitedById,
      invite_expires_at: new Date(now.getTime() + INVITATION_TTL_MS),
      disabled_at: null,
    };
    const row = await this.prisma.$transaction(async (tx) => {
      // Invitations of one phone are decided one at a time, across venues
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'staff-invite:' + phone}))`;

      const [user, elsewhere, own] = await Promise.all([
        tx.user.findUnique({ where: { phone }, select: { id: true } }),
        tx.organization_member.findFirst({
          where: {
            phone,
            organization_id: { not: organizationId },
            ...openInvitationWhere(now),
          },
          select: { id: true },
        }),
        tx.organization_member.findUnique({
          where: {
            organization_id_phone: { organization_id: organizationId, phone },
          },
        }),
      ]);
      if (user || elsewhere || (own && own.user_id))
        throw new AppException('phone_taken', {
          message: 'Phone already belongs to a staff account',
        });

      return own
        ? tx.organization_member.update({ where: { id: own.id }, data })
        : tx.organization_member.create({
            data: { organization_id: organizationId, phone, ...data },
          });
    });

    await this.events.log('staff_invited', ctx, {
      userId: invitedById,
      organizationId,
      phone,
      meta: { member_id: row.id },
    });
    return toStaffMember(row, now);
  }

  /**
   * Disables an operator: the account cannot sign in and every login of it ends at once. An invitation
   * is cancelled. The owner cannot be disabled. Disabling again changes nothing.
   */
  async disable(organizationId: string, memberId: string, ctx: RequestCtx) {
    const member = await this.prisma.organization_member.findFirst({
      where: { id: memberId, organization_id: organizationId },
    });
    if (!member)
      throw new AppException('not_found', {
        message: 'Staff member not found',
      });
    if (member.role === 'owner')
      throw new AppException('forbidden', {
        message: 'The owner cannot be disabled',
      });
    if (member.status === 'disabled') return;

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.organization_member.update({
        where: { id: member.id },
        data: { status: 'disabled', disabled_at: now, invite_expires_at: null },
      });
      if (member.user_id)
        await tx.user.update({
          where: { id: member.user_id },
          data: { isActive: false },
        });
    });
    // After the commit: the access tokens of the ended logins stop at once (sid denylist)
    if (member.user_id) await this.sessions.revokeAllForUser(member.user_id);

    await this.events.log('staff_disabled', ctx, {
      userId: member.user_id ?? undefined,
      organizationId,
      phone: member.phone,
      meta: { member_id: member.id },
    });
  }
}
