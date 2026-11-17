import type {
  PosMenu,
  PosMenuItem,
  PosModifierGroup,
} from '../provider/pos-provider';

/**
 * The parts of iiko `MenuV3` (POST /api/menu/v3/by_id) Xmenu reads. Field names follow the iiko
 * OpenAPI spec (api-ru.iiko.services/api-docs/docs): categories are `itemsGroups`, sizes and prices
 * `sizePrices`, the full modifier data lives in the top-level `modifiers` and `products` lists.
 */
export interface IikoMenuV3 {
  itemsGroups?: IikoItemsGroup[] | null;
  modifiers?: IikoModifier[] | null;
  products?: IikoProduct[] | null;
}

interface IikoItemsGroup {
  id: string;
  name: string;
  isHidden?: boolean;
  items?: IikoItem[] | null;
}

interface IikoItem {
  productId?: string | null;
  name: string;
  isHidden?: boolean;
  description?: string | null;
  sortOrder?: number | null;
  sizePrices?: IikoSizePrice[] | null;
  modifierGroups?: IikoModifierGroup[] | null;
}

interface IikoSizePrice {
  sizeId?: string | null;
  sizeName?: string | null;
  isDefault?: boolean;
  price?: number | null;
  buttonImageUrl?: string | null;
  isHidden?: boolean;
  weight?: number;
  measureUnitType?: 'GRAM' | 'KILOGRAM' | 'MILLILITER' | 'LITER' | null;
  nutritions?: {
    fats?: number | null;
    proteins?: number | null;
    carbs?: number | null;
    energy?: number | null;
  } | null;
}

interface IikoRestrictions {
  minQuantity?: number;
  maxQuantity?: number;
}

interface IikoModifierGroup {
  id?: string | null;
  name: string;
  isHidden?: boolean;
  restrictions?: IikoRestrictions | null;
  items?: IikoModifierItem[] | null;
}

/** Overrides of the reference modifier with the same id: null takes the reference value. */
interface IikoModifierItem {
  id: string;
  name?: string | null;
  isHidden?: boolean | null;
}

interface IikoModifier {
  id: string;
  name?: string | null;
  isHidden?: boolean | null;
  sizePrices?: { sizeId?: string | null; price?: number | null }[] | null;
}

interface IikoProduct {
  id: string;
  canSetOpenPrice?: boolean;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Price of a modifier for the item's size: the size's own price, else the size-less one, else 0. */
function modifierPrice(mod: IikoModifier | undefined, sizeId: string | null) {
  const prices = mod?.sizePrices ?? [];
  const own = prices.find((p) => (p.sizeId ?? null) === sizeId);
  const plain = prices.find((p) => !p.sizeId);
  return Math.max(0, num((own ?? plain ?? prices[0])?.price) ?? 0);
}

function weightOf(size: IikoSizePrice | undefined): {
  weight: number | null;
  unit: 'gr' | 'ml';
} {
  const w = num(size?.weight);
  const unit = size?.measureUnitType ?? 'GRAM';
  const ml = unit === 'MILLILITER' || unit === 'LITER';
  // iiko weighs in kilograms and litres for KILOGRAM and LITER
  const scale = unit === 'KILOGRAM' || unit === 'LITER' ? 1000 : 1;
  return {
    weight: w && w > 0 ? Math.round(w * scale * 100) / 100 : null,
    unit: ml ? 'ml' : 'gr',
  };
}

function groupsOf(
  item: IikoItem,
  productId: string,
  refs: Map<string, IikoModifier>,
  sizeId: string | null,
): PosModifierGroup[] {
  const out: PosModifierGroup[] = [];
  (item.modifierGroups ?? []).forEach((g, i) => {
    if (g.isHidden) return;
    const options = (g.items ?? []).flatMap((m) => {
      const ref = refs.get(m.id);
      if (m.isHidden ?? ref?.isHidden) return [];
      const name = (m.name ?? ref?.name ?? '').trim();
      if (!name) return [];
      return [{ externalId: m.id, name, price: modifierPrice(ref, sizeId) }];
    });
    if (!options.length) return;
    const min = Math.max(0, num(g.restrictions?.minQuantity) ?? 0);
    const rawMax = num(g.restrictions?.maxQuantity) ?? 0;
    // iiko: maxQuantity 0 means no limit
    const max = rawMax > 0 ? Math.max(rawMax, min) : options.length;
    out.push({
      externalId: g.id || `${productId}#${i}`,
      name: g.name.trim() || '—',
      min: Math.min(min, options.length),
      max: Math.max(1, Math.min(max, options.length)),
      options,
    });
  });
  return out;
}

/**
 * Normalizes an iiko external menu. The service item that carries the delivery fee is left out of
 * the guest menu; an item listed in several groups is taken once (from the first group). Prices are
 * those of the price category the menu was requested for.
 */
export function iikoMenuToPos(
  menu: IikoMenuV3,
  opts: { serviceItemId?: string | null } = {},
): PosMenu {
  const refs = new Map((menu.modifiers ?? []).map((m) => [m.id, m]));
  const openPrice = new Map(
    (menu.products ?? []).map((p) => [p.id, Boolean(p.canSetOpenPrice)]),
  );
  const seen = new Set<string>();
  const categories: PosMenu['categories'] = [];
  const items: PosMenuItem[] = [];
  for (const group of menu.itemsGroups ?? []) {
    if (!group?.id) continue;
    categories.push({
      externalId: group.id,
      name: group.name?.trim() || '—',
      hidden: Boolean(group.isHidden),
    });
    (group.items ?? []).forEach((item, position) => {
      const productId = item.productId;
      if (!productId || seen.has(productId)) return;
      if (productId === opts.serviceItemId) return;
      seen.add(productId);
      const sizes = (item.sizePrices ?? []).filter(
        (s) => !s.isHidden && num(s.price) !== null,
      );
      const def = sizes.find((s) => s.isDefault) ?? sizes[0];
      const cheapest = sizes.reduce<number | null>(
        (min, s) => (min === null ? s.price! : Math.min(min, s.price!)),
        null,
      );
      const sized = sizes.length > 1 && sizes.every((s) => s.sizeId);
      const { weight, unit } = weightOf(def);
      const n = def?.nutritions;
      items.push({
        externalId: productId,
        categoryExternalId: group.id,
        name: item.name?.trim() || '—',
        description: item.description?.trim() || null,
        hidden: Boolean(item.isHidden) || !def,
        sortOrder: num(item.sortOrder) ?? position,
        price: Math.max(0, cheapest ?? 0),
        sizes: sized
          ? sizes.map((s) => ({
              sizeId: s.sizeId!,
              name: s.sizeName?.trim() || '—',
              price: Math.max(0, s.price!),
              isDefault: Boolean(s.isDefault),
            }))
          : [],
        modifierGroups: groupsOf(item, productId, refs, def?.sizeId ?? null),
        weight,
        unit,
        nutrition: {
          protein: num(n?.proteins),
          fat: num(n?.fats),
          carbohydrate: num(n?.carbs),
          kcal: num(n?.energy),
        },
        imageUrl: sizes.find((s) => s.buttonImageUrl)?.buttonImageUrl ?? null,
        openPrice: openPrice.get(productId) ?? false,
      });
    });
  }
  return { categories, items };
}

/** Items of an external menu offered as the "Delivery" service item (any item can be chosen). */
export function iikoServiceItemCandidates(menu: IikoMenuV3) {
  const out: {
    itemId: string;
    name: string;
    sizes: { sizeId: string; name: string }[];
    openPrice: boolean;
  }[] = [];
  const seen = new Set<string>();
  const openPrice = new Map(
    (menu.products ?? []).map((p) => [p.id, Boolean(p.canSetOpenPrice)]),
  );
  for (const group of menu.itemsGroups ?? [])
    for (const item of group.items ?? []) {
      if (!item.productId || seen.has(item.productId)) continue;
      seen.add(item.productId);
      out.push({
        itemId: item.productId,
        name: item.name?.trim() || '—',
        sizes: (item.sizePrices ?? [])
          .filter((s) => s.sizeId)
          .map((s) => ({ sizeId: s.sizeId!, name: s.sizeName?.trim() || '—' })),
        openPrice: openPrice.get(item.productId) ?? false,
      });
    }
  return out;
}
