import { formatWeight, groupLimits, MenuCategoryRow, publicFileUrl, toMenuView } from './menu.mapper';

const tr = (lang: string, title: string, description?: string) => ({ lang, title, description: description ?? null });

const category = (over: Partial<MenuCategoryRow> = {}): MenuCategoryRow =>
  ({
    id: 'c1',
    translations: [tr('ru', 'Акции'), tr('uz', 'Aksiyalar')],
    products: [
      {
        id: 'p1', price: 45000, weight: 800, unit: 'gr', kcal: 325.4, protein: 70, fat: null, carbohydrate: 24,
        translations: [tr('ru', 'Мант с бараниной', 'Описание'), tr('uz', 'Qo\'y go\'shtli manti')],
        images: [{ url: '/uploads/a.png' }, { url: '/uploads/b.png' }],
        additional_product_groups: [
          {
            id: 'g1', is_required: true, is_multiple: true, min_selected: 2, max_selected: 4,
            translations: [tr('ru', 'Добавки')],
            additional_products: [
              { id: 'o1', price: 3500, translations: [tr('ru', 'Катык')] },
              { id: 'o2', price: 0, translations: [tr('ru', 'Лазжон')] },
              { id: 'o3', price: 0, translations: [tr('ru', 'Лазжон 2')] },
            ],
          },
          {
            id: 'g2', is_required: false, is_multiple: false, min_selected: null, max_selected: null,
            translations: [tr('ru', 'Сироп')],
            additional_products: [{ id: 'o4', price: 1999.6, translations: [tr('ru', 'Катык')] }],
          },
          { id: 'g3', is_required: true, is_multiple: false, min_selected: null, max_selected: null, translations: [tr('ru', 'Пустая')], additional_products: [] },
        ],
      },
    ],
    ...over,
  }) as unknown as MenuCategoryRow;

const locale = (lang: 'ru' | 'uz' | 'en', fallback: 'ru' | 'uz' | 'en' = 'ru', currency = 'UZS') => ({ lang, fallback, currency });

describe('toMenuView', () => {
  it('maps categories, items and the language fallback', () => {
    const ru = toMenuView([category()], locale('ru'));
    expect(ru[0]).toMatchObject({ id: 'c1', title: 'Акции' });
    expect(ru[0].items[0]).toMatchObject({ id: 'p1', name: 'Мант с бараниной', description: 'Описание', price: 45000, currency: 'UZS', weight: '800 г', image: '/uploads/a.png' });
    expect(toMenuView([category()], locale('uz'))[0].items[0].name).toBe("Qo'y go'shtli manti");
    expect(toMenuView([category()], locale('en', 'ru'))[0].title).toBe('Акции'); // no en → tenant default ru
    expect(toMenuView([category()], locale('en', 'uz'))[0].title).toBe('Aksiyalar'); // no en → tenant default uz
  });

  it("prices in the tenant's currency", () => {
    const item = toMenuView([category()], locale('ru', 'ru', 'USD'))[0].items[0];
    expect(item.currency).toBe('USD');
    expect(item.optionGroups.every((g) => g.currency === 'USD')).toBe(true);
  });

  it('nutrition: only the known values, with units', () => {
    expect(toMenuView([category()], locale('ru'))[0].items[0].nutrition).toEqual({ kcal: 325, protein: '70 г', carbs: '24 г' });
  });

  it('option groups: limits, selection type, sums rounded, empty groups hidden', () => {
    const groups = toMenuView([category()], locale('ru'))[0].items[0].optionGroups;
    expect(groups).toHaveLength(2); // g3 has nothing to choose
    expect(groups[0]).toMatchObject({ id: 'g1', selectionType: 'multi', required: true, min: 2, max: 3 }); // max clamped to option count
    expect(groups[1]).toMatchObject({ id: 'g2', selectionType: 'single', required: false, min: null, max: 1 });
    expect(groups[1].options[0].price).toBe(2000);
  });

  it('drops categories without any active product', () => {
    expect(toMenuView([category({ products: [] })], locale('ru'))).toEqual([]);
  });
});

describe('groupLimits (legacy flags without min/max columns)', () => {
  const g = (is_required: boolean, is_multiple: boolean) => ({ is_required, is_multiple, min_selected: null, max_selected: null });
  it('required single → exactly one', () => expect(groupLimits(g(true, false), 5)).toEqual({ required: true, multiple: false, min: 1, max: 1 }));
  it('optional multiple → 0..all', () => expect(groupLimits(g(false, true), 5)).toEqual({ required: false, multiple: true, min: 0, max: 5 }));
  it('required multiple → 1..all', () => expect(groupLimits(g(true, true), 3)).toEqual({ required: true, multiple: true, min: 1, max: 3 }));
});

describe('formatWeight', () => {
  it('formats by language and unit', () => {
    expect(formatWeight(350, 'gr', 'ru')).toBe('350 г');
    expect(formatWeight(330, 'ml', 'uz')).toBe('330 ml');
    expect(formatWeight(1.5, 'gr', 'en')).toBe('1.5 g');
    expect(formatWeight(null, 'gr', 'ru')).toBe('');
  });
});

describe('publicFileUrl', () => {
  it('makes relative upload paths absolute using PUBLIC_FILES_URL, then PUBLIC_API_URL', () => {
    expect(publicFileUrl('/a.png', { PUBLIC_API_URL: 'https://api.x.uz/' } as any)).toBe('https://api.x.uz/a.png');
    expect(publicFileUrl('a.png', { PUBLIC_FILES_URL: 'https://cdn.x.uz', PUBLIC_API_URL: 'https://api.x.uz' } as any)).toBe('https://cdn.x.uz/a.png');
  });
  it('leaves absolute URLs and missing values alone', () => {
    expect(publicFileUrl('https://other/a.png', { PUBLIC_API_URL: 'https://api.x.uz' } as any)).toBe('https://other/a.png');
    expect(publicFileUrl(null)).toBeNull();
    expect(publicFileUrl('/a.png', {} as any)).toBe('/a.png');
  });
});
