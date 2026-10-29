import { CustomerAuthException } from 'src/modules/auth/errors/customer-auth.exception';
import { BranchCandidate, chooseBranch } from './branch-choice';

type B = { title: string };
const branch = (
  id: string,
  over: { pickup?: boolean; delivery?: boolean; scheduled?: boolean; isOpen?: boolean; opensAt?: string | null } = {},
): BranchCandidate<B> => ({
  branch: { id, title: id, accepts_pickup: over.pickup ?? true, accepts_delivery: over.delivery ?? true },
  scheduled: over.scheduled ?? true,
  state: { isOpen: over.isOpen ?? true, opensAt: over.opensAt ?? null },
});
const noHours = (id: string) => branch(id, { scheduled: false, isOpen: false });

const errorOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as CustomerAuthException;
  }
  throw new Error('expected an error');
};

describe('chooseBranch', () => {
  describe('pickup', () => {
    it('returns the open branch the customer chose', () => {
      expect(chooseBranch([branch('a'), branch('b')], 'pickup', 'b').id).toBe('b');
    });

    it('refuses a branch without working hours with branch_hours_not_set (422)', () => {
      const e = errorOf(() => chooseBranch([noHours('a')], 'pickup', 'a'));
      expect(e.code).toBe('branch_hours_not_set');
      expect(e.getStatus()).toBe(422);
    });

    it('refuses a closed branch with branch_closed and the next opening', () => {
      const e = errorOf(() => chooseBranch([branch('a', { isOpen: false, opensAt: '09:00' })], 'pickup', 'a'));
      expect(e.code).toBe('branch_closed');
      expect(e.getResponse()).toMatchObject({ details: { opensAt: '09:00' } });
    });

    it('checks pickup support before hours', () => {
      expect(errorOf(() => chooseBranch([branch('a', { pickup: false, scheduled: false })], 'pickup', 'a')).code)
        .toBe('fulfillment_unavailable');
    });
  });

  describe('delivery', () => {
    it('skips branches without working hours and picks an open one', () => {
      expect(chooseBranch([noHours('a'), branch('b')], 'delivery').id).toBe('b');
    });

    it('does not use a requested branch without hours', () => {
      expect(chooseBranch([noHours('a'), branch('b')], 'delivery', 'a').id).toBe('b');
    });

    it('answers branch_hours_not_set when no delivering branch has hours', () => {
      expect(errorOf(() => chooseBranch([noHours('a'), noHours('b')], 'delivery')).code).toBe('branch_hours_not_set');
    });

    it('answers branch_closed with the earliest opening of scheduled branches', () => {
      const e = errorOf(() =>
        chooseBranch(
          [noHours('a'), branch('b', { isOpen: false, opensAt: '10:00' }), branch('c', { isOpen: false, opensAt: '08:00' })],
          'delivery',
        ),
      );
      expect(e.code).toBe('branch_closed');
      expect(e.getResponse()).toMatchObject({ details: { opensAt: '08:00' } });
    });
  });
});
