import type { StaffRole } from 'src/modules/auth/access/permissions';

/** How long an operator invitation can be accepted; inviting the phone again restarts it. */
export const INVITATION_TTL_MS = 72 * 3600 * 1000;

export const STAFF_MEMBER_STATUSES = [
  'invited',
  'expired',
  'active',
  'disabled',
] as const;
export type StaffMemberStatus = (typeof STAFF_MEMBER_STATUSES)[number];

export interface StaffMemberRow {
  id: string;
  role: StaffRole;
  status: 'invited' | 'active' | 'disabled';
  phone: string;
  first_name: string;
  last_name: string | null;
  created_at: Date;
  invite_expires_at: Date | null;
  activated_at: Date | null;
  disabled_at: Date | null;
}

/** The status the owner sees: an invitation past its term shows as expired. */
export function memberStatus(
  row: Pick<StaffMemberRow, 'status' | 'invite_expires_at'>,
  now: Date,
): StaffMemberStatus {
  if (
    row.status === 'invited' &&
    (!row.invite_expires_at || row.invite_expires_at <= now)
  )
    return 'expired';
  return row.status;
}

export function toStaffMember(row: StaffMemberRow, now: Date) {
  return {
    id: row.id,
    role: row.role,
    status: memberStatus(row, now),
    phone: row.phone,
    firstName: row.first_name,
    lastName: row.last_name,
    invitedAt: row.created_at,
    inviteExpiresAt: row.status === 'invited' ? row.invite_expires_at : null,
    activatedAt: row.activated_at,
    disabledAt: row.disabled_at,
  };
}

/** The owner first, then by when they were added. */
export function byRoleThenAdded(a: StaffMemberRow, b: StaffMemberRow) {
  if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
  return a.created_at.getTime() - b.created_at.getTime();
}
