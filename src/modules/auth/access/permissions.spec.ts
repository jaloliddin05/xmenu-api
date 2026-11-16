import { PERMISSIONS, permissionsOf, roleCan } from './permissions';

describe('role permissions', () => {
  it('the owner may do everything', () => {
    expect(permissionsOf('owner')).toEqual([...PERMISSIONS]);
  });

  // Widening the operator is a product decision (docs/DELIVERY.md, "Роли"): change this list on purpose
  it('the operator: orders, couriers, shifts, reading branches and the menu, own account; no venue, money or staff', () => {
    expect(permissionsOf('operator').sort()).toEqual(
      [
        'account',
        'branches.read',
        'couriers',
        'menu.read',
        'orders',
        'profile',
        'shifts',
      ].sort(),
    );
    expect(roleCan('operator', 'venue')).toBe(false);
    expect(roleCan('operator', 'staff')).toBe(false);
    // the operator sees and assigns couriers, the owner adds, invites and disables them (W13-04)
    expect(roleCan('operator', 'couriers.manage')).toBe(false);
    expect(roleCan('owner', 'couriers.manage')).toBe(true);
  });

  it('no role, no permissions', () => {
    expect(permissionsOf(null)).toEqual([]);
    expect(roleCan(undefined, 'account')).toBe(false);
  });
});
