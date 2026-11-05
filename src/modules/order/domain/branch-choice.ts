import type { OpenState } from 'src/modules/branch/domain/branch-hours';
import { AppException } from 'src/infra/errors/app-exception';

export interface BranchCandidate<B> {
  branch: B & {
    id: string;
    accepts_pickup: boolean;
    accepts_delivery: boolean;
  };
  /** Working hours were entered; a branch without them is closed (branch_hours_not_set). */
  scheduled: boolean;
  state: OpenState;
}

/**
 * Branch for a new order. pickup: the branch the customer chose, it must be open. delivery: the
 * requested branch if it is open, otherwise the first open branch that delivers. Branches without
 * working hours never take orders: if they are the only candidates the error is branch_hours_not_set,
 * otherwise branch_closed with the earliest opening time.
 */
export function chooseBranch<B>(
  all: BranchCandidate<B>[],
  mode: 'delivery' | 'pickup',
  requestedId?: string,
): BranchCandidate<B>['branch'] {
  const supports = (b: BranchCandidate<B>) =>
    mode === 'pickup' ? b.branch.accepts_pickup : b.branch.accepts_delivery;
  const isOpen = (b: BranchCandidate<B>) => b.scheduled && b.state.isOpen;
  const noHours = (message: string) =>
    new AppException('branch_hours_not_set', { message: message });

  if (mode === 'pickup') {
    if (!requestedId)
      throw new AppException('validation_error', {
        message: 'branchId is required for pickup',
      });
    const chosen = all.find((b) => b.branch.id === requestedId);
    if (!chosen)
      throw new AppException('validation_error', {
        message: 'Branch not found',
      });
    if (!supports(chosen))
      throw new AppException('fulfillment_unavailable', {
        message: 'This branch does not offer pickup',
      });
    if (!chosen.scheduled) throw noHours('Branch has no working hours');
    if (!isOpen(chosen)) {
      throw new AppException('branch_closed', {
        message: 'Branch is closed',
        details: { opensAt: chosen.state.opensAt },
      });
    }
    return chosen.branch;
  }

  if (requestedId && !all.some((b) => b.branch.id === requestedId)) {
    throw new AppException('validation_error', { message: 'Branch not found' });
  }
  const candidates = all.filter(supports);
  if (candidates.length === 0)
    throw new AppException('fulfillment_unavailable', {
      message: 'Delivery is not available',
    });

  const preferred = candidates.find(
    (b) => b.branch.id === requestedId && isOpen(b),
  );
  const open = preferred ?? candidates.find(isOpen);
  if (open) return open.branch;

  const scheduled = candidates.filter((b) => b.scheduled);
  if (scheduled.length === 0)
    throw noHours('No delivering branch has working hours');
  const next =
    scheduled
      .map((b) => b.state.opensAt)
      .filter(Boolean)
      .sort()[0] ?? null;
  throw new AppException('branch_closed', {
    message: 'All branches are closed',
    details: { opensAt: next },
  });
}
