/**
 * Public QR-menu response of GET /organization/slug/:slug. Field names stay snake_case as the QR
 * front-end reads them; internal columns (owner_id, order_seq, int_id, is_active, foreign keys,
 * sort indexes, file paths on disk, translation row ids) never leave the API.
 */

type Tr<K extends string> = { lang: string } & Record<K, string | null>;
interface FileRow {
  id: string;
  url: string;
}

export interface PublicFile {
  id: string;
  url: string;
}

export interface PublicModifier {
  id: string;
  price: number;
  translations: Tr<'title'>[];
}

export interface PublicModifierGroup {
  id: string;
  is_required: boolean;
  is_multiple: boolean;
  min_selected: number | null;
  max_selected: number | null;
  translations: Tr<'title'>[];
  additional_products: PublicModifier[];
}

export interface PublicProduct {
  id: string;
  price: number;
  weight: number | null;
  protein: number | null;
  kcal: number | null;
  fat: number | null;
  carbohydrate: number | null;
  unit: string;
  images: PublicFile[];
  translations: Tr<'title' | 'description'>[];
  additional_product_groups: PublicModifierGroup[];
}

export interface PublicCategory {
  id: string;
  translations: Tr<'title'>[];
  products: PublicProduct[];
}

export interface PublicOrganization {
  id: string;
  name: string;
  slug: string | null;
  type: string;
  logo: PublicFile | null;
  banner: PublicFile | null;
  translations: Tr<'description'>[];
  categories: PublicCategory[];
}

/** Minimal shape of the Prisma row the mapper needs (extra columns are ignored). */
export interface OrganizationTreeRow {
  id: string;
  name: string;
  slug: string | null;
  type: string;
  logo: FileRow | null;
  banner: FileRow | null;
  translations: { lang: string; description: string | null }[];
  categories: {
    id: string;
    translations: { lang: string; title: string }[];
    products: {
      id: string;
      price: number;
      weight: number | null;
      protein: number | null;
      kcal: number | null;
      fat: number | null;
      carbohydrate: number | null;
      unit: string;
      images: FileRow[];
      translations: { lang: string; title: string; description: string | null }[];
      additional_product_groups: {
        id: string;
        is_required: boolean | null;
        is_multiple: boolean | null;
        min_selected: number | null;
        max_selected: number | null;
        translations: { lang: string; title: string }[];
        additional_products: { id: string; price: number; translations: { lang: string; title: string }[] }[];
      }[];
    }[];
  }[];
}

const file = (f: FileRow | null): PublicFile | null => (f ? { id: f.id, url: f.url } : null);
const titles = (list: { lang: string; title: string }[]) => list.map((t) => ({ lang: t.lang, title: t.title }));

export function toPublicOrganization(o: OrganizationTreeRow): PublicOrganization {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    type: o.type,
    logo: file(o.logo),
    banner: file(o.banner),
    translations: o.translations.map((t) => ({ lang: t.lang, description: t.description })),
    categories: o.categories.map((c) => ({
      id: c.id,
      translations: titles(c.translations),
      products: c.products.map((p) => ({
        id: p.id,
        price: p.price,
        weight: p.weight,
        protein: p.protein,
        kcal: p.kcal,
        fat: p.fat,
        carbohydrate: p.carbohydrate,
        unit: p.unit,
        images: p.images.map((i) => file(i)!),
        translations: p.translations.map((t) => ({ lang: t.lang, title: t.title, description: t.description })),
        additional_product_groups: p.additional_product_groups.map((g) => ({
          id: g.id,
          is_required: g.is_required ?? false,
          is_multiple: g.is_multiple ?? false,
          min_selected: g.min_selected,
          max_selected: g.max_selected,
          translations: titles(g.translations),
          additional_products: g.additional_products.map((m) => ({
            id: m.id,
            price: m.price,
            translations: titles(m.translations),
          })),
        })),
      })),
    })),
  };
}
