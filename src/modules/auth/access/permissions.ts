/**
 * Staff roles and what each may do. Everything not listed is denied: a staff route without a
 * StaffAccess rule answers 403 (StaffAccessGuard), and the access matrix spec fails on it.
 * Contract: docs/API.md, "Сотрудники и права".
 */
export const STAFF_ROLES = ['owner', 'operator'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PERMISSIONS = [
  // Own login: /user/me, password change, sessions
  'account',
  // Own profile: name and avatar
  'profile',
  // Orders: list, card, accept, reject, statuses, cancel with a reason
  'orders',
  // See the couriers (to assign them) and work the shifts (the cash reconciliation of a shift included)
  'couriers',
  'shifts',
  // Manage the couriers: add, edit, invite, disable (docs/DELIVERY.md: the owner adds a courier)
  'couriers.manage',
  // Read the branch list (the order filter)
  'branches.read',
  // Read the menu
  'menu.read',
  // The venue: settings, branches and menu changes, prices, payment keys, domains, bot, publication
  'venue',
  // Staff accounts: invite and disable operators
  'staff',
  // Delivery reports with money: couriers (cash, pay), external services, problems
  'reports',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const OPERATOR: readonly Permission[] = [
  'account',
  'profile',
  'orders',
  'couriers',
  'shifts',
  'branches.read',
  'menu.read',
];

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  operator: OPERATOR,
};

export function permissionsOf(
  role: StaffRole | null | undefined,
): Permission[] {
  return role ? [...ROLE_PERMISSIONS[role]] : [];
}

export function roleCan(
  role: StaffRole | null | undefined,
  permission: Permission,
): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(permission);
}
