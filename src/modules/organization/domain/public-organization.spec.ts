import { toPublicOrganization } from './public-organization';

const INTERNAL = [
  'owner_id',
  'order_seq',
  'int_id',
  'is_active',
  'created_at',
  'logo_id',
  'banner_id',
  'organization_id',
  'category_id',
  'product_id',
  'additional_product_group_id',
  'index',
  'path',
];

/** Every key at any depth of a JSON value. */
const keysDeep = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.flatMap(keysDeep)
    : v && typeof v === 'object'
      ? Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)])
      : [];

// A raw Prisma row as GET /organization/slug/:slug used to return it.
const row = {
  id: 'org-1',
  int_id: 7,
  name: 'Mant',
  slug: 'mant',
  type: 'restaurant',
  is_active: true,
  url: null,
  created_at: new Date(),
  order_seq: 1042,
  owner_id: 'user-1',
  logo_id: 'f-1',
  banner_id: null,
  logo: { id: 'f-1', url: 'https://files/x.png', path: '/srv/uploads/x.png', product_id: null, created_at: new Date() },
  banner: null,
  translations: [{ id: 'tr-1', lang: 'ru', description: 'Манты', organization_id: 'org-1' }],
  categories: [
    {
      id: 'c-1',
      organization_id: 'org-1',
      index: 0,
      is_active: true,
      created_at: new Date(),
      translations: [{ id: 'ct-1', lang: 'ru', title: 'Горячее' }],
      products: [
        {
          id: 'p-1',
          category_id: 'c-1',
          index: 0,
          is_active: true,
          created_at: new Date(),
          price: 25000,
          weight: 300,
          protein: null,
          kcal: 450,
          fat: null,
          carbohydrate: null,
          unit: 'gr',
          images: [{ id: 'f-2', url: 'https://files/p.png', path: '/srv/uploads/p.png', product_id: 'p-1' }],
          translations: [{ id: 'pt-1', lang: 'ru', title: 'Манты', description: null }],
          additional_product_groups: [
            {
              id: 'g-1',
              product_id: 'p-1',
              organization_id: 'org-1',
              created_at: new Date(),
              is_required: null,
              is_multiple: true,
              min_selected: null,
              max_selected: 2,
              translations: [{ id: 'gt-1', lang: 'ru', title: 'Соус' }],
              additional_products: [
                {
                  id: 'm-1',
                  additional_product_group_id: 'g-1',
                  created_at: new Date(),
                  price: 3000,
                  translations: [{ id: 'mt-1', lang: 'ru', title: 'Сметана' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('toPublicOrganization', () => {
  const pub = toPublicOrganization(row);

  it('drops every internal column at any depth', () => {
    const keys = keysDeep(pub);
    for (const k of INTERNAL) expect(keys).not.toContain(k);
  });

  it('keeps the fields the QR menu reads', () => {
    expect(pub).toEqual({
      id: 'org-1',
      name: 'Mant',
      slug: 'mant',
      type: 'restaurant',
      logo: { id: 'f-1', url: 'https://files/x.png' },
      banner: null,
      translations: [{ lang: 'ru', description: 'Манты' }],
      categories: [
        {
          id: 'c-1',
          translations: [{ lang: 'ru', title: 'Горячее' }],
          products: [
            {
              id: 'p-1',
              price: 25000,
              weight: 300,
              protein: null,
              kcal: 450,
              fat: null,
              carbohydrate: null,
              unit: 'gr',
              images: [{ id: 'f-2', url: 'https://files/p.png' }],
              translations: [{ lang: 'ru', title: 'Манты', description: null }],
              additional_product_groups: [
                {
                  id: 'g-1',
                  is_required: false,
                  is_multiple: true,
                  min_selected: null,
                  max_selected: 2,
                  translations: [{ lang: 'ru', title: 'Соус' }],
                  additional_products: [{ id: 'm-1', price: 3000, translations: [{ lang: 'ru', title: 'Сметана' }] }],
                },
              ],
            },
          ],
        },
      ],
    });
  });
});
