import { AppException } from 'src/infra/errors/app-exception';
import { BranchCandidate, chooseBranch } from './branch-choice';

type B = { title: string };
const branch = (
  id: string,
  over: {
    pickup?: boolean;
    delivery?: boolean;
    scheduled?: boolean;
    isOpen?: boolean;
    opensAt?: string | null;
  } = {},
): BranchCandidate<B> => ({
  branch: {
    id,
    title: id,
    accepts_pickup: over.pickup ?? true,
    accepts_delivery: over.delivery ?? true,
  },
  scheduled: over.scheduled ?? true,
  state: {
    isOpen: over.isOpen ?? true,
    opensAt: over.opensAt?.slice(11, 16) ?? null,
    opensDate: over.opensAt?.slice(0, 10) ?? null,
  },
  opensAt: over.opensAt ?? null,
});
const noHours = (id: string) => branch(id, { scheduled: false, isOpen: false });

const errorOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as AppException;
  }
  throw new Error('expected an error');
};

describe('chooseBranch', () => {
  describe('pickup', () => {
    it('returns the open branch the customer chose', () => {
      expect(chooseBranch([branch('a'), branch('b')], 'pickup', 'b').id).toBe(
        'b',
      );
    });

    it('refuses a branch without working hours with branch_hours_not_set (422)', () => {
      const e = errorOf(() => chooseBranch([noHours('a')], 'pickup', 'a'));
      expect(e.code).toBe('branch_hours_not_set');
      expect(e.getStatus()).toBe(422);
    });

    it('refuses a closed branch with branch_closed and the next opening', () => {
      const e = errorOf(() =>
        chooseBranch(
          [
            branch('a', {
              isOpen: false,
              opensAt: '2026-11-11T09:00:00+05:00',
            }),
          ],
          'pickup',
          'a',
        ),
      );
      expect(e.code).toBe('branch_closed');
      // The same form as GET /branches: the date tells today from tomorrow (W9-09)
      expect(e.getResponse()).toMatchObject({
        details: { opensAt: '2026-11-11T09:00:00+05:00' },
      });
    });

    it('checks pickup support before hours', () => {
      expect(
        errorOf(() =>
          chooseBranch(
            [branch('a', { pickup: false, scheduled: false })],
            'pickup',
            'a',
          ),
        ).code,
      ).toBe('fulfillment_unavailable');
    });
  });

  describe('delivery', () => {
    it('skips branches without working hours and picks an open one', () => {
      expect(chooseBranch([noHours('a'), branch('b')], 'delivery').id).toBe(
        'b',
      );
    });

    it('does not use a requested branch without hours', () => {
      expect(
        chooseBranch([noHours('a'), branch('b')], 'delivery', 'a').id,
      ).toBe('b');
    });

    it('answers branch_hours_not_set when no delivering branch has hours', () => {
      expect(
        errorOf(() => chooseBranch([noHours('a'), noHours('b')], 'delivery'))
          .code,
      ).toBe('branch_hours_not_set');
    });

    it('answers branch_closed with the earliest opening of scheduled branches', () => {
      const e = errorOf(() =>
        chooseBranch(
          [
            noHours('a'),
            branch('b', {
              isOpen: false,
              opensAt: '2026-11-11T10:00:00+05:00',
            }),
            branch('c', {
              isOpen: false,
              opensAt: '2026-11-11T08:00:00+05:00',
            }),
          ],
          'delivery',
        ),
      );
      expect(e.code).toBe('branch_closed');
      expect(e.getResponse()).toMatchObject({
        details: { opensAt: '2026-11-11T08:00:00+05:00' },
      });
    });

    it('compares openings as instants: 10:00 today is earlier than 08:00 tomorrow', () => {
      const e = errorOf(() =>
        chooseBranch(
          [
            branch('tomorrow', {
              isOpen: false,
              opensAt: '2026-11-12T08:00:00+05:00',
            }),
            branch('today', {
              isOpen: false,
              opensAt: '2026-11-11T10:00:00+05:00',
            }),
          ],
          'delivery',
        ),
      );
      expect(e.getResponse()).toMatchObject({
        details: { opensAt: '2026-11-11T10:00:00+05:00' },
      });
    });

    it('compares across time zones: 09:00+05:00 is later than 03:00+00:00', () => {
      const e = errorOf(() =>
        chooseBranch(
          [
            branch('tashkent', {
              isOpen: false,
              opensAt: '2026-11-11T09:00:00+05:00',
            }),
            branch('utc', {
              isOpen: false,
              opensAt: '2026-11-11T03:00:00+00:00',
            }),
          ],
          'delivery',
        ),
      );
      expect(e.getResponse()).toMatchObject({
        details: { opensAt: '2026-11-11T03:00:00+00:00' },
      });
    });

    it('opensAt null when no scheduled branch opens within seven days', () => {
      const e = errorOf(() =>
        chooseBranch([branch('a', { isOpen: false })], 'delivery'),
      );
      expect(e.code).toBe('branch_closed');
      expect(e.getResponse()).toMatchObject({ details: { opensAt: null } });
    });
  });
});
