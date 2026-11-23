import type { OpenState } from 'src/modules/branch/domain/branch-hours';
import { AppException } from 'src/infra/errors/app-exception';
import {
  DeliveryRate,
  DeliveryRules,
  distanceKm,
  hasRules,
  LatLng,
  rateFor,
} from 'src/modules/branch/domain/delivery-pricing';
import {
  DeliveryArea,
  inArea,
} from 'src/modules/delivery/domain/delivery-area';

export interface BranchCandidate<B> {
  branch: B & {
    id: string;
    accepts_pickup: boolean;
    accepts_delivery: boolean;
  };
  /** Working hours were entered; a branch without them is closed (branch_hours_not_set). */
  scheduled: boolean;
  state: OpenState;
  /**
   * Next opening as ISO 8601 with the date and the branch UTC offset (opensAtIso, as in GET /branches);
   * null while open or when nothing opens in the next seven days.
   */
  opensAt: string | null;
}

/** Throws branch_hours_not_set or branch_closed (earliest opening, compared as instants) for closed branches. */
function throwClosed<B>(closed: BranchCandidate<B>[], what: string): never {
  const scheduled = closed.filter((b) => b.scheduled);
  if (scheduled.length === 0)
    throw new AppException('branch_hours_not_set', {
      message: `No ${what} branch has working hours`,
    });
  // Compared as instants: branches may open on different days and in different time zones
  const next =
    scheduled
      .map((b) => b.opensAt)
      .filter((at): at is string => at !== null)
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  throw new AppException('branch_closed', {
    message: 'All branches are closed',
    details: { opensAt: next },
  });
}

const isOpen = <B>(b: BranchCandidate<B>) => b.scheduled && b.state.isOpen;

/**
 * Pickup branch: the one the customer chose; it must take pickup and be open. A branch without working
 * hours never takes orders (branch_hours_not_set); a closed one answers branch_closed with its next opening
 * (details.opensAt: ISO 8601 with date and offset).
 */
export function choosePickupBranch<B>(
  all: BranchCandidate<B>[],
  requestedId: string | undefined,
): BranchCandidate<B>['branch'] {
  if (!requestedId)
    throw new AppException('validation_error', {
      message: 'branchId is required for pickup',
    });
  const chosen = all.find((b) => b.branch.id === requestedId);
  if (!chosen)
    throw new AppException('validation_error', {
      message: 'Branch not found',
    });
  if (!chosen.branch.accepts_pickup)
    throw new AppException('fulfillment_unavailable', {
      message: 'This branch does not offer pickup',
    });
  if (!chosen.scheduled)
    throw new AppException('branch_hours_not_set', {
      message: 'Branch has no working hours',
    });
  if (!isOpen(chosen)) {
    throw new AppException('branch_closed', {
      message: 'Branch is closed',
      details: { opensAt: chosen.opensAt },
    });
  }
  return chosen.branch;
}

export type DeliveryCandidate<B> = BranchCandidate<
  B & { latitude: number; longitude: number }
> & { rules: DeliveryRules };

export interface DeliveryChoice<B> {
  candidate: DeliveryCandidate<B>;
  rate: DeliveryRate;
}

/**
 * Delivery branch for an address (docs/DELIVERY.md, "Стоимость доставки и выбор филиала"). The first problem,
 * in this order:
 *  - no branch takes delivery: fulfillment_unavailable
 *  - no coordinates, or the venue area is set and the address is outside it: out_of_delivery_zone
 *  - no area and no branch has pricing rules: delivery_not_configured
 * Then:
 *  1. Branches whose own rules (zones, distance) cover the address; inside the venue area only, so a branch
 *     rule reaching past the area does not apply there. The nearest open one in a straight line (ties: the
 *     given order, i.e. sort_order); covering ones all closed: branch_hours_not_set (none has hours) or
 *     branch_closed (opensAt).
 *  2. None covers it and the venue area is set: the nearest open delivering branch at the venue default rule
 *     (rate 'default'); none open: branch_hours_not_set or branch_closed.
 *  3. None covers it and there is no area: out_of_delivery_zone.
 */
export function chooseDeliveryBranch<B>(
  all: DeliveryCandidate<B>[],
  address: LatLng | null,
  area: DeliveryArea | null = null,
): DeliveryChoice<B> {
  const delivering = all.filter((b) => b.branch.accepts_delivery);
  if (delivering.length === 0)
    throw new AppException('fulfillment_unavailable', {
      message: 'Delivery is not available',
    });
  if (area && (!address || !inArea(area, address))) throw outOfZone();
  const priced = delivering.filter((b) => hasRules(b.rules));
  if (!area && priced.length === 0)
    throw new AppException('delivery_not_configured', {
      message: 'No branch has delivery pricing',
    });
  const covering: DeliveryChoice<B>[] = [];
  if (address) {
    for (const candidate of priced) {
      const rate = rateFor(candidate.rules, pointOf(candidate), address);
      if (rate) covering.push({ candidate, rate });
    }
  }
  if (covering.length > 0) {
    const open = covering.filter((c) => isOpen(c.candidate));
    if (open.length === 0)
      throwClosed(
        covering.map((c) => c.candidate),
        'delivering',
      );
    return nearest(open);
  }
  if (!area || !address) throw outOfZone();
  const open = delivering.filter(isOpen);
  if (open.length === 0) throwClosed(delivering, 'delivering');
  return nearest(
    open.map((candidate) => ({
      candidate,
      rate: {
        rule: 'default' as const,
        distanceKm: distanceKm(pointOf(candidate), address),
      },
    })),
  );
}

/**
 * What one branch charges for an address, as the guest would get it from this branch (the owner's address
 * check; hours and other branches aside), by the same rules as chooseDeliveryBranch: outside a set venue area
 * nothing (inArea false); the branch rules (zone, distance); otherwise, with an area, the venue default rule
 * from this branch. inArea is null when the venue has no area.
 */
export function branchRateFor(
  rules: DeliveryRules,
  branchPoint: LatLng,
  address: LatLng,
  area: DeliveryArea | null,
): { inArea: boolean | null; rate: DeliveryRate | null } {
  if (area && !inArea(area, address)) return { inArea: false, rate: null };
  const own = rateFor(rules, branchPoint, address);
  const rate: DeliveryRate | null =
    own ??
    (area
      ? { rule: 'default', distanceKm: distanceKm(branchPoint, address) }
      : null);
  return { inArea: area ? true : null, rate };
}

const pointOf = <B>(c: DeliveryCandidate<B>): LatLng => [
  c.branch.latitude,
  c.branch.longitude,
];

const outOfZone = () =>
  new AppException('out_of_delivery_zone', {
    message: 'Address is outside the delivery zone',
  });

// Array.prototype.sort is stable: equal distances keep the given order
const nearest = <B>(choices: DeliveryChoice<B>[]): DeliveryChoice<B> =>
  [...choices].sort((a, b) => a.rate.distanceKm - b.rate.distanceKm)[0];
