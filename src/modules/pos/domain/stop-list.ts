/** A stopped dish (`optionId: null`) or one stopped size of it (`optionId`: its "size" option). */
export interface StoppedRow {
  productId: string;
  optionId: string | null;
  balance: number;
}

/**
 * What a POS stop list stops in Xmenu (asked with returnSize, so entries carry the size). An entry
 * with a balance above zero is a remaining quantity, not a stop. An entry without a size, or of a dish
 * imported without sizes, stops the dish; an entry with a size stops that size option, and a dish
 * whose every size is stopped is stopped as a whole. Unknown positions and sizes are skipped.
 */
export function stoppedProducts(
  items: { externalId: string; sizeId: string | null; balance: number }[],
  /** POS item id → Xmenu product id */
  products: ReadonlyMap<string, string>,
  /** POS item id → its sizes: POS size id → Xmenu "size" option id */
  sizes: ReadonlyMap<string, ReadonlyMap<string, string>>,
): StoppedRow[] {
  const whole = new Set<string>();
  const stoppedSizes = new Map<string, Set<string>>();
  for (const i of items) {
    if (i.balance > 0 || !products.has(i.externalId)) continue;
    const itemSizes = sizes.get(i.externalId);
    if (!i.sizeId || !itemSizes?.size) whole.add(i.externalId);
    else if (itemSizes.has(i.sizeId))
      stoppedSizes.set(
        i.externalId,
        (stoppedSizes.get(i.externalId) ?? new Set()).add(i.sizeId),
      );
  }
  const out: StoppedRow[] = [];
  for (const [itemId, set] of stoppedSizes) {
    if (whole.has(itemId)) continue;
    const itemSizes = sizes.get(itemId)!;
    if (set.size >= itemSizes.size) {
      whole.add(itemId);
      continue;
    }
    for (const sizeId of set)
      out.push({
        productId: products.get(itemId)!,
        optionId: itemSizes.get(sizeId)!,
        balance: 0,
      });
  }
  return [
    ...[...whole].map((itemId) => ({
      productId: products.get(itemId)!,
      optionId: null,
      balance: 0,
    })),
    ...out,
  ];
}

/**
 * A dish (or a size option, `key`) is unavailable in the venue-wide menu only when every branch
 * linked to the POS has it in the stop list; with `branchId` the stop list of that branch decides.
 */
function stoppedEverywhere<T>(
  stops: { key: T; branch_id: string }[],
  linkedBranchIds: string[],
  branchId?: string,
): Set<T> {
  if (branchId)
    return new Set(
      stops.filter((s) => s.branch_id === branchId).map((s) => s.key),
    );
  if (!linkedBranchIds.length) return new Set();
  const byKey = new Map<T, Set<string>>();
  for (const s of stops)
    byKey.set(s.key, (byKey.get(s.key) ?? new Set()).add(s.branch_id));
  return new Set(
    [...byKey]
      .filter(([, branches]) => linkedBranchIds.every((b) => branches.has(b)))
      .map(([key]) => key),
  );
}

/** Dishes stopped as a whole (rows without an option). */
export function hiddenByStopList(
  stops: { product_id: string; option_id?: string | null; branch_id: string }[],
  linkedBranchIds: string[],
  branchId?: string,
): Set<string> {
  return stoppedEverywhere(
    stops
      .filter((s) => !s.option_id)
      .map((s) => ({ key: s.product_id, branch_id: s.branch_id })),
    linkedBranchIds,
    branchId,
  );
}

/** Size options stopped (the dish itself stays orderable in its other sizes). */
export function stoppedOptions(
  stops: { option_id?: string | null; branch_id: string }[],
  linkedBranchIds: string[],
  branchId?: string,
): Set<string> {
  return stoppedEverywhere(
    stops
      .filter((s) => s.option_id)
      .map((s) => ({ key: s.option_id!, branch_id: s.branch_id })),
    linkedBranchIds,
    branchId,
  );
}
