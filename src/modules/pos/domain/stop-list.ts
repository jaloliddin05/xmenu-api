/**
 * Which Xmenu dishes a POS stop list stops. An entry with a balance above zero is a remaining
 * quantity, not a stop. An entry without a size stops the dish; for a dish imported with sizes
 * (several "size" options) it stops only when every size is in the list: Xmenu shows availability
 * per dish, not per option.
 */
export function stoppedProducts(
  items: { externalId: string; sizeId: string | null; balance: number }[],
  /** POS item id → Xmenu product id */
  products: ReadonlyMap<string, string>,
  /** POS item id → number of its size options */
  sizes: ReadonlyMap<string, number>,
): { productId: string; balance: number }[] {
  const whole = new Set<string>();
  const stoppedSizes = new Map<string, Set<string>>();
  for (const i of items) {
    if (i.balance > 0 || !products.has(i.externalId)) continue;
    if (!i.sizeId || !sizes.get(i.externalId)) whole.add(i.externalId);
    else
      stoppedSizes.set(
        i.externalId,
        (stoppedSizes.get(i.externalId) ?? new Set()).add(i.sizeId),
      );
  }
  for (const [itemId, set] of stoppedSizes)
    if (set.size >= (sizes.get(itemId) ?? 0)) whole.add(itemId);
  return [...whole].map((itemId) => ({
    productId: products.get(itemId)!,
    balance: 0,
  }));
}

/**
 * A dish is left out of the venue-wide menu only when every branch linked to the POS has it in the
 * stop list; with `branchId` the stop list of that branch decides.
 */
export function hiddenByStopList(
  stops: { product_id: string; branch_id: string }[],
  linkedBranchIds: string[],
  branchId?: string,
): Set<string> {
  if (branchId)
    return new Set(
      stops.filter((s) => s.branch_id === branchId).map((s) => s.product_id),
    );
  if (!linkedBranchIds.length) return new Set();
  const byProduct = new Map<string, Set<string>>();
  for (const s of stops)
    byProduct.set(
      s.product_id,
      (byProduct.get(s.product_id) ?? new Set()).add(s.branch_id),
    );
  return new Set(
    [...byProduct]
      .filter(([, branches]) => linkedBranchIds.every((b) => branches.has(b)))
      .map(([id]) => id),
  );
}
