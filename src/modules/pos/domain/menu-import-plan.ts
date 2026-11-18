import type {
  PosMenu,
  PosMenuCategory,
  PosMenuItem,
} from '../provider/pos-provider';

/**
 * What a menu import does, decided before anything is written (docs/IIKO.md, "Меню"):
 * - a linked row (pos_menu_link) is updated, never duplicated;
 * - only when pairing (the first connection, or the owner's "match again"), dishes and categories
 *   without a link are paired with the POS by exact name, or by the pairs the owner confirmed; paired
 *   rows get linked, dishes without a pair are hidden (is_active = false), not deleted. A regular
 *   import (schedule, button) leaves rows without a link alone (audit W15-02);
 * - POS positions without a link are created;
 * - a linked position gone from the POS (or hidden there) is hidden through its link;
 * - a name changed in the POS marks the other translations stale;
 * - a POS picture is copied only when it changed and the owner has not uploaded one.
 */
export interface CurrentLink {
  id: string;
  kind: 'category' | 'product';
  externalId: string;
  rowId: string;
  sourceName: string;
  sourceImageUrl: string | null;
}

export interface CurrentRow {
  id: string;
  /** Name in the language the POS names are written to */
  title: string | null;
}

export interface CurrentProduct extends CurrentRow {
  /** Has a picture the owner uploaded (wins over the POS one) */
  hasOwnerImage: boolean;
}

export interface MenuMatch {
  productId: string;
  /** null: the owner says this dish has no pair in the POS (it is hidden) */
  itemId: string | null;
}

export interface PlanInput {
  menu: PosMenu;
  /** Pair and hide the rows without a link (first connection, "match again") */
  pairing: boolean;
  /** The "Delivery" service item: never shown to guests */
  serviceItemId: string | null;
  links: CurrentLink[];
  /** Dishes and categories of the venue without a link */
  unlinkedProducts: CurrentProduct[];
  unlinkedCategories: CurrentRow[];
  /** Products with a link: whether the owner uploaded a picture */
  ownerImageProductIds: ReadonlySet<string>;
  /** Pairs the owner confirmed; dishes not listed are paired by name */
  matches?: MenuMatch[];
}

export interface PlannedCategory {
  source: PosMenuCategory;
  /** Existing category to update (linked or paired now); null = create */
  targetId: string | null;
  /** Existing link; null = create one */
  linkId: string | null;
  nameChanged: boolean;
}

export interface PlannedProduct {
  source: PosMenuItem;
  targetId: string | null;
  linkId: string | null;
  nameChanged: boolean;
  /** POS picture to copy now (null: keep the current picture) */
  downloadImage: string | null;
}

export interface MenuPair {
  productId: string;
  itemId: string;
  /** Paired by name (not confirmed by the owner) */
  byName: boolean;
}

export interface ImportPlan {
  categories: PlannedCategory[];
  products: PlannedProduct[];
  /** Pairs made on this import (first connection) */
  pairs: MenuPair[];
  /** Dishes without a pair: hidden, not deleted */
  hideProducts: string[];
  /** Links whose position is gone from the POS: hidden */
  goneLinks: string[];
}

const norm = (s: string | null | undefined) => (s ?? '').trim();

/** Pairs unlinked rows with POS positions: the owner's choice first, then exact name. */
function pairByName<R extends CurrentRow>(
  rows: R[],
  positions: { externalId: string; name: string }[],
  fixed: Map<string, string | null> = new Map(),
): Map<string, string> {
  const pairs = new Map<string, string>();
  const taken = new Set<string>();
  const known = new Set(positions.map((p) => p.externalId));
  for (const [rowId, externalId] of fixed)
    if (externalId && known.has(externalId) && !taken.has(externalId)) {
      pairs.set(rowId, externalId);
      taken.add(externalId);
    }
  const byName = new Map<string, string[]>();
  for (const p of positions) {
    const key = norm(p.name);
    if (!key || taken.has(p.externalId)) continue;
    byName.set(key, [...(byName.get(key) ?? []), p.externalId]);
  }
  for (const row of rows) {
    if (fixed.has(row.id)) continue;
    const candidates = byName.get(norm(row.title)) ?? [];
    const free = candidates.find((id) => !taken.has(id));
    if (!free) continue;
    pairs.set(row.id, free);
    taken.add(free);
  }
  return pairs;
}

export function planMenuImport(planInput: PlanInput): ImportPlan {
  // Without pairing the rows without a link are not looked at
  const input: PlanInput = planInput.pairing
    ? planInput
    : {
        ...planInput,
        unlinkedProducts: [],
        unlinkedCategories: [],
        matches: [],
      };
  const items = input.menu.items.filter(
    (i) => i.externalId !== input.serviceItemId,
  );
  const linkOf = (kind: CurrentLink['kind'], externalId: string) =>
    input.links.find((l) => l.kind === kind && l.externalId === externalId);

  // Categories
  const unlinkedCategoryPositions = input.menu.categories.filter(
    (c) => !linkOf('category', c.externalId),
  );
  const categoryPairs = pairByName(
    input.unlinkedCategories,
    unlinkedCategoryPositions.map((c) => ({
      externalId: c.externalId,
      name: c.name,
    })),
  );
  const categoryByExternal = new Map(
    [...categoryPairs].map(([rowId, ext]) => [ext, rowId]),
  );
  const categories: PlannedCategory[] = input.menu.categories.map((c) => {
    const link = linkOf('category', c.externalId);
    return {
      source: c,
      targetId: link?.rowId ?? categoryByExternal.get(c.externalId) ?? null,
      linkId: link?.id ?? null,
      nameChanged: Boolean(link && link.sourceName !== c.name),
    };
  });

  // Dishes
  const fixed = new Map(
    (input.matches ?? []).map((m) => [m.productId, m.itemId] as const),
  );
  const unlinkedItems = items.filter((i) => !linkOf('product', i.externalId));
  const productPairs = pairByName(
    input.unlinkedProducts,
    unlinkedItems.map((i) => ({ externalId: i.externalId, name: i.name })),
    fixed,
  );
  const productByExternal = new Map(
    [...productPairs].map(([rowId, ext]) => [ext, rowId]),
  );
  const ownerImage = new Set(input.ownerImageProductIds);
  for (const p of input.unlinkedProducts)
    if (p.hasOwnerImage) ownerImage.add(p.id);

  const products: PlannedProduct[] = items.map((item) => {
    const link = linkOf('product', item.externalId);
    const targetId =
      link?.rowId ?? productByExternal.get(item.externalId) ?? null;
    const keepOwner = targetId !== null && ownerImage.has(targetId);
    const changed = item.imageUrl && item.imageUrl !== link?.sourceImageUrl;
    return {
      source: item,
      targetId,
      linkId: link?.id ?? null,
      nameChanged: Boolean(link && link.sourceName !== item.name),
      downloadImage: changed && !keepOwner ? item.imageUrl : null,
    };
  });

  const present = new Set([
    ...input.menu.categories.map((c) => `category|${c.externalId}`),
    ...items.map((i) => `product|${i.externalId}`),
  ]);
  return {
    categories,
    products,
    pairs: [...productPairs].map(([productId, itemId]) => ({
      productId,
      itemId,
      byName: !fixed.has(productId),
    })),
    hideProducts: input.unlinkedProducts
      .filter((p) => !productPairs.has(p.id))
      .map((p) => p.id),
    goneLinks: input.links
      .filter((l) => !present.has(`${l.kind}|${l.externalId}`))
      .map((l) => l.id),
  };
}
