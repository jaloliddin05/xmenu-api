import type {
  additional_product,
  additional_product_group,
  additional_product_group_translation,
  additional_product_translation,
  category,
  category_translation,
  file,
  product,
  product_translation,
} from '@prisma/client';
import { Lang, pickTranslation } from 'src/infra/http/request-helpers';
import { toSum } from 'src/modules/order/domain/order-money';

export type MenuProductRow = product & {
  translations: product_translation[];
  images: file[];
  additional_product_groups: (additional_product_group & {
    translations: additional_product_group_translation[];
    additional_products: (additional_product & { translations: additional_product_translation[] })[];
  })[];
};

export type MenuCategoryRow = category & {
  translations: category_translation[];
  products: MenuProductRow[];
};

export const CURRENCY = 'UZS';

/**
 * file.url bazada faqat uploads ichidagi nisbiy yo'l ("/abc.png") sifatida
 * saqlanadi — frontend boshqa domenda bo'lgani uchun mutlaq URL kerak.
 * Asos: PUBLIC_FILES_URL, bo'lmasa PUBLIC_API_URL (ServeStatic uploads'ni
 * backend ildizidan beradi). Allaqachon mutlaq bo'lsa tegilmaydi.
 */
export function publicFileUrl(url: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const base = (env.PUBLIC_FILES_URL || env.PUBLIC_API_URL || '').replace(/\/+$/, '');
  return base ? `${base}${url.startsWith('/') ? url : `/${url}`}` : url;
}

const UNIT: Record<string, Record<Lang, string>> = {
  gr: { ru: 'г', uz: 'g', en: 'g' },
  ml: { ru: 'мл', uz: 'ml', en: 'ml' },
};

export function formatWeight(weight: number | null, unit: string, lang: Lang): string {
  if (weight == null || weight <= 0) return '';
  return `${Number.isInteger(weight) ? weight : weight.toFixed(1)} ${UNIT[unit]?.[lang] ?? unit}`;
}

/**
 * Tanlov chegaralari: min/max ustunlari bo'lsa o'sha; bo'lmasa eski ikki
 * bayroqdan: is_required → kamida 1, is_multiple=false → ko'pi bilan 1.
 * (Serverdagi tekshiruv — order-pricing.service — AYNAN shu funksiyadan foydalanadi.)
 */
export function groupLimits(g: Pick<additional_product_group, 'is_required' | 'is_multiple' | 'min_selected' | 'max_selected'>, optionCount: number) {
  const required = g.is_required === true;
  const multiple = g.is_multiple === true;
  const min = g.min_selected ?? (required ? 1 : 0);
  const max = g.max_selected ?? (multiple ? optionCount : 1);
  return { required, multiple, min, max: Math.max(1, Math.min(max, optionCount)) };
}

export function toMenuView(categories: MenuCategoryRow[], lang: Lang) {
  return categories
    .map((c) => ({
      id: c.id,
      title: pickTranslation(c.translations, lang)?.title ?? '',
      items: c.products.map((p) => toItemView(p, lang)),
    }))
    .filter((c) => c.items.length > 0);
}

function toItemView(p: MenuProductRow, lang: Lang) {
  const t = pickTranslation(p.translations, lang);
  const g = UNIT.gr[lang];
  const nutrition: Record<string, number | string> = {};
  if (p.kcal != null) nutrition.kcal = Math.round(p.kcal);
  if (p.protein != null) nutrition.protein = `${p.protein} ${g}`;
  if (p.fat != null) nutrition.fat = `${p.fat} ${g}`;
  if (p.carbohydrate != null) nutrition.carbs = `${p.carbohydrate} ${g}`;

  return {
    id: p.id,
    name: t?.title ?? '',
    description: t?.description ?? '',
    image: publicFileUrl(p.images[0]?.url),
    images: p.images.map((i) => publicFileUrl(i.url) as string),
    price: toSum(p.price),
    currency: CURRENCY,
    weight: formatWeight(p.weight, p.unit, lang),
    nutrition: Object.keys(nutrition).length ? nutrition : null,
    optionGroups: p.additional_product_groups
      // Tanlanadigan narsasi yo'q guruh mijozga ko'rsatilmaydi (majburiy bo'lsa buyurtmani butunlay bloklab qo'yardi)
      .filter((grp) => grp.additional_products.length > 0)
      .map((grp) => {
        const limits = groupLimits(grp, grp.additional_products.length);
        return {
          id: grp.id,
          title: pickTranslation(grp.translations, lang)?.title ?? '',
          selectionType: limits.multiple ? 'multi' : 'single',
          required: limits.required,
          min: limits.min > 0 ? limits.min : null,
          max: limits.max,
          currency: CURRENCY,
          options: grp.additional_products.map((o) => ({
            id: o.id,
            name: pickTranslation(o.translations, lang)?.title ?? '',
            price: toSum(o.price),
          })),
        };
      }),
  };
}

export type MenuView = ReturnType<typeof toMenuView>;
