import { AppException } from 'src/infra/errors/app-exception';
import type {
  DeliveryRules,
  LatLng,
} from 'src/modules/branch/domain/delivery-pricing';
import {
  BranchCandidate,
  chooseDeliveryBranch,
  choosePickupBranch,
  DeliveryCandidate,
} from './branch-choice';

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

describe('choosePickupBranch', () => {
  describe('pickup', () => {
    it('returns the open branch the customer chose', () => {
      expect(choosePickupBranch([branch('a'), branch('b')], 'b').id).toBe('b');
    });

    it('refuses a branch without working hours with branch_hours_not_set (422)', () => {
      const e = errorOf(() => choosePickupBranch([noHours('a')], 'a'));
      expect(e.code).toBe('branch_hours_not_set');
      expect(e.getStatus()).toBe(422);
    });

    it('refuses a closed branch with branch_closed and the next opening', () => {
      const e = errorOf(() =>
        choosePickupBranch(
          [
            branch('a', {
              isOpen: false,
              opensAt: '2026-11-11T09:00:00+05:00',
            }),
          ],
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
          choosePickupBranch(
            [branch('a', { pickup: false, scheduled: false })],
            'a',
          ),
        ).code,
      ).toBe('fulfillment_unavailable');
    });
  });
});

// Branches on a line going north from the address; 0.009 degrees of latitude is about 1 km
const ADDRESS: LatLng = [41.3, 69.25];
const km = (n: number): LatLng => [ADDRESS[0] + n * 0.009, ADDRESS[1]];
const radius = (maxKm: number): DeliveryRules => ({
  zones: [],
  distance: {
    basePrice: 10000,
    includedKm: 1,
    pricePerKm: 1000,
    maxKm,
    minOrder: 0,
    freeFrom: null,
  },
});
const delivering = (
  id: string,
  at: LatLng,
  over: {
    rules?: DeliveryRules;
    delivery?: boolean;
    scheduled?: boolean;
    isOpen?: boolean;
    opensAt?: string | null;
  } = {},
): DeliveryCandidate<B> => {
  const c = branch(id, over);
  return {
    ...c,
    branch: { ...c.branch, latitude: at[0], longitude: at[1] },
    rules: over.rules ?? radius(20),
  };
};
const idOf = (c: DeliveryCandidate<B>[], at: LatLng | null = ADDRESS) =>
  chooseDeliveryBranch(c, at).candidate.branch.id;

describe('chooseDeliveryBranch', () => {
  it('picks the nearest of the open branches that cover the address', () => {
    expect(
      idOf([
        delivering('far', km(5)),
        delivering('near', km(1)),
        delivering('mid', km(3)),
      ]),
    ).toBe('near');
  });

  it('returns the rate of the chosen branch', () => {
    const choice = chooseDeliveryBranch([delivering('a', km(2))], ADDRESS);
    expect(choice.rate.rule).toBe('distance');
    expect(choice.rate.distanceKm).toBeCloseTo(2, 1);
  });

  it('equal distance: the first in sort order', () => {
    expect(
      idOf([delivering('first', km(2)), delivering('second', km(-2))]),
    ).toBe('first');
  });

  it('skips a nearer branch that is closed or has no hours', () => {
    expect(
      idOf([
        delivering('closed', km(1), { isOpen: false }),
        delivering('nohours', km(1.5), { scheduled: false, isOpen: false }),
        delivering('open', km(4)),
      ]),
    ).toBe('open');
  });

  it('skips a nearer branch whose rules do not reach the address', () => {
    expect(
      idOf([
        delivering('short', km(1), { rules: radius(0.5) }),
        delivering('reaches', km(4)),
      ]),
    ).toBe('reaches');
  });

  it('a branch without delivery never takes the order', () => {
    expect(
      idOf([
        delivering('pickup-only', km(1), { delivery: false }),
        delivering('delivers', km(4)),
      ]),
    ).toBe('delivers');
    expect(
      errorOf(() => idOf([delivering('a', km(1), { delivery: false })])).code,
    ).toBe('fulfillment_unavailable');
  });

  it('no delivering branch has rules: delivery_not_configured (422)', () => {
    const e = errorOf(() =>
      idOf([delivering('a', km(1), { rules: { zones: [], distance: null } })]),
    );
    expect(e.code).toBe('delivery_not_configured');
    expect(e.getStatus()).toBe(422);
  });

  it('address covered by no branch, or without coordinates: out_of_delivery_zone', () => {
    expect(errorOf(() => idOf([delivering('a', km(30))])).code).toBe(
      'out_of_delivery_zone',
    );
    expect(errorOf(() => idOf([delivering('a', km(1))], null)).code).toBe(
      'out_of_delivery_zone',
    );
  });

  it('covering branches closed: branch_closed with the earliest opening among them', () => {
    const e = errorOf(() =>
      idOf([
        delivering('later', km(1), {
          isOpen: false,
          opensAt: '2026-11-11T10:00:00+05:00',
        }),
        delivering('sooner', km(2), {
          isOpen: false,
          opensAt: '2026-11-11T08:00:00+05:00',
        }),
        // Opens first, but does not reach the address: not counted
        delivering('elsewhere', km(2), {
          rules: radius(1),
          isOpen: false,
          opensAt: '2026-11-11T07:00:00+05:00',
        }),
      ]),
    );
    expect(e.code).toBe('branch_closed');
    expect(e.getResponse()).toMatchObject({
      details: { opensAt: '2026-11-11T08:00:00+05:00' },
    });
  });

  it('compares openings as instants across days and time zones', () => {
    const e = errorOf(() =>
      idOf([
        delivering('tomorrow', km(1), {
          isOpen: false,
          opensAt: '2026-11-12T08:00:00+05:00',
        }),
        delivering('utc', km(1), {
          isOpen: false,
          opensAt: '2026-11-11T03:00:00+00:00',
        }),
      ]),
    );
    expect(e.getResponse()).toMatchObject({
      details: { opensAt: '2026-11-11T03:00:00+00:00' },
    });
  });

  it('opensAt null when no covering branch opens within seven days', () => {
    const e = errorOf(() => idOf([delivering('a', km(1), { isOpen: false })]));
    expect(e.code).toBe('branch_closed');
    expect(e.getResponse()).toMatchObject({ details: { opensAt: null } });
  });

  it('covering branches without hours: branch_hours_not_set', () => {
    expect(
      errorOf(() =>
        idOf([delivering('a', km(1), { scheduled: false, isOpen: false })]),
      ).code,
    ).toBe('branch_hours_not_set');
  });
});
