import { SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions';

export const STAFF_ACCESS_KEY = 'STAFF_ACCESS';

export interface StaffAccessRule {
  /** What the route needs; the platform-admin rule is checked by PlatformAdminGuard instead. */
  permission: Permission | 'platform-admin';
  /** Path parameter holding the caller's organization id: another id answers 404. */
  orgParam?: string;
}

/**
 * The access rule of a staff route (required on every route that is not @Public). Applied to the
 * method, not the class, so a new method never inherits a rule by accident.
 */
export const StaffAccess = (
  permission: Permission,
  options: { orgParam?: string } = {},
) =>
  SetMetadata<string, StaffAccessRule>(STAFF_ACCESS_KEY, {
    permission,
    ...options,
  });

/** Platform endpoints (not venue data): PlatformAdminGuard decides, a venue role grants nothing. */
export const PlatformAdminRoute = () =>
  SetMetadata<string, StaffAccessRule>(STAFF_ACCESS_KEY, {
    permission: 'platform-admin',
  });
