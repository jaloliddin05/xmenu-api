import { Lang, pickTranslation } from 'src/infra/http/request-helpers';
import { CustomerAuthException } from 'src/modules/auth/errors/customer-auth.exception';
import { formatWeight, groupLimits, MenuProductRow, publicFileUrl } from 'src/modules/menu/menu.mapper';
import { toSum } from './order-money';

export const MAX_LINE_QUANTITY = 50;

export type PricingProduct = MenuProductRow & { category: { is_active: boolean | null } };

export interface RequestItem {
  itemId: string;
  quantity: number;
  modifiers?: { groupId: string; optionIds: string[] }[];
}

export interface PricedOption {
  groupId: string;
  groupTitle: string;
  optionId: string;
  name: string;
  price: number;
  position: number;
}

export interface PricedLine {
  productId: string;
  name: string;
  image: string | null;
  weight: string;
  basePrice: number;
  unitPrice: number;
  quantity: number;
  position: number;
  options: PricedOption[];
}

type Problem = { index: number; itemId: string; reason: string; groupId?: string };

/**
 * So'rov pozitsiyalarini BAZADAGI narxlar bilan hisoblaydi. Mijozdan faqat
 * id va miqdor keladi — narx, nom, modifikator qoidalari bazadan. Hech narsa
 * yozmaydi, faqat tekshiradi va xato bo'lsa CustomerAuthException tashlaydi
 * (details.items[].index — so'rovdagi pozitsiya indeksi, frontend shu bo'yicha
 * qatorlarni belgilaydi).
 *
 *  - item_unavailable: taom yo'q / o'chirilgan / kategoriyasi o'chirilgan
 *  - invalid_modifiers: noma'lum guruh/variant, takror, majburiy tanlanmagan,
 *    min/max buzilgan — frontend validateSelections() bilan bir xil qoida
 *  - invalid_order: miqdor 1..50 emas
 */
export function priceLines(
  items: RequestItem[],
  products: Map<string, PricingProduct>,
  lang: Lang,
): { lines: PricedLine[]; subtotal: number } {
  const unavailable: Problem[] = [];
  const invalid: Problem[] = [];

  items.forEach((item, index) => {
    const p = products.get(item.itemId);
    const available = p && p.is_active !== false && p.category.is_active !== false;
    if (!available) unavailable.push({ index, itemId: item.itemId, reason: 'not_available' });
  });
  if (unavailable.length) {
    throw new CustomerAuthException('item_unavailable', 'Some items are unavailable', undefined, { items: unavailable });
  }

  items.forEach((item, index) => {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_LINE_QUANTITY) {
      throw new CustomerAuthException('invalid_order', `quantity must be 1..${MAX_LINE_QUANTITY}`);
    }
    const reason = modifierProblem(products.get(item.itemId)!, item.modifiers ?? []);
    if (reason) invalid.push({ index, itemId: item.itemId, ...reason });
  });
  if (invalid.length) {
    throw new CustomerAuthException('invalid_modifiers', 'Invalid modifiers', undefined, { items: invalid });
  }

  const lines: PricedLine[] = items.map((item, position) => {
    const p = products.get(item.itemId)!;
    const options: PricedOption[] = [];
    let addons = 0;

    // Guruhlar va variantlar BAZADAGI tartibda yoziladi (so'rov tartibida emas).
    for (const group of p.additional_product_groups) {
      const chosen = new Set(item.modifiers?.find((m) => m.groupId === group.id)?.optionIds ?? []);
      for (const option of group.additional_products) {
        if (!chosen.has(option.id)) continue;
        const price = toSum(option.price);
        addons += price;
        options.push({
          groupId: group.id,
          groupTitle: pickTranslation(group.translations, lang)?.title ?? '',
          optionId: option.id,
          name: pickTranslation(option.translations, lang)?.title ?? '',
          price,
          position: options.length,
        });
      }
    }

    const basePrice = toSum(p.price);
    return {
      productId: p.id,
      name: pickTranslation(p.translations, lang)?.title ?? '',
      image: publicFileUrl(p.images[0]?.url),
      weight: formatWeight(p.weight, p.unit, lang),
      basePrice,
      unitPrice: basePrice + addons,
      quantity: item.quantity,
      position,
      options,
    };
  });

  return { lines, subtotal: lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0) };
}

function modifierProblem(
  product: PricingProduct,
  modifiers: { groupId: string; optionIds: string[] }[],
): { reason: string; groupId?: string } | null {
  const groups = new Map(product.additional_product_groups.filter((g) => g.additional_products.length > 0).map((g) => [g.id, g]));
  const seen = new Set<string>();

  for (const m of modifiers) {
    const group = groups.get(m.groupId);
    if (!group) return { reason: 'unknown_group', groupId: m.groupId };
    if (seen.has(m.groupId)) return { reason: 'duplicate_group', groupId: m.groupId };
    seen.add(m.groupId);

    const ids = new Set<string>();
    for (const id of m.optionIds) {
      if (!group.additional_products.some((o) => o.id === id)) return { reason: 'unknown_option', groupId: m.groupId };
      if (ids.has(id)) return { reason: 'duplicate_option', groupId: m.groupId };
      ids.add(id);
    }
  }

  for (const group of groups.values()) {
    const count = modifiers.find((m) => m.groupId === group.id)?.optionIds.length ?? 0;
    const { required, min, max } = groupLimits(group, group.additional_products.length);
    if (required && count === 0) return { reason: 'missing_required', groupId: group.id };
    if (count > 0 && count < min) return { reason: 'below_min', groupId: group.id };
    if (count > max) return { reason: 'above_max', groupId: group.id };
  }
  return null;
}
