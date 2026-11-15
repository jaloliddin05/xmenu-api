import type { OpenState } from 'src/modules/branch/domain/branch-hours';
import { AppException } from 'src/infra/errors/app-exception';
import {
  DeliveryRate,
  DeliveryRules,
  hasRules,
  LatLng,
  rateFor,
} from 'src/modules/branch/domain/delivery-pricing';

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
 * Delivery branch for an address (docs/DELIVERY.md): of the active branches that are open now, take delivery
 * and deliver to the address by their own rules, the nearest in a straight line (ties: the given order, i.e.
 * sort_order). The first problem, in this order:
 *  - no branch takes delivery: fulfillment_unavailable
 *  - none of them has pricing rules: delivery_not_configured
 *  - no coordinates, or no branch covers the address: out_of_delivery_zone
 *  - the covering branches are closed: branch_hours_not_set (none has hours) or branch_closed (opensAt)
 */
export function chooseDeliveryBranch<B>(
  all: DeliveryCandidate<B>[],
  address: LatLng | null,
): DeliveryChoice<B> {
  const delivering = all.filter((b) => b.branch.accepts_delivery);
  if (delivering.length === 0)
    throw new AppException('fulfillment_unavailable', {
      message: 'Delivery is not available',
    });
  const priced = delivering.filter((b) => hasRules(b.rules));
  if (priced.length === 0)
    throw new AppException('delivery_not_configured', {
      message: 'No branch has delivery pricing',
    });
  const covering: DeliveryChoice<B>[] = [];
  if (address) {
    for (const candidate of priced) {
      const rate = rateFor(
        candidate.rules,
        [candidate.branch.latitude, candidate.branch.longitude],
        address,
      );
      if (rate) covering.push({ candidate, rate });
    }
  }
  if (covering.length === 0)
    throw new AppException('out_of_delivery_zone', {
      message: 'Address is outside the delivery zone',
    });
  const open = covering.filter((c) => isOpen(c.candidate));
  if (open.length === 0)
    throwClosed(
      covering.map((c) => c.candidate),
      'delivering',
    );
  // Array.prototype.sort is stable: equal distances keep the given order
  return [...open].sort((a, b) => a.rate.distanceKm - b.rate.distanceKm)[0];
}
