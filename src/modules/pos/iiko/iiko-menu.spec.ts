import { iikoMenuToPos, IikoMenuV3 } from './iiko-menu';

/** A MenuV3 shaped like the iiko OpenAPI spec: itemsGroups → items → sizePrices, modifiers by id. */
const MENU: IikoMenuV3 = {
  itemsGroups: [
    {
      id: 'g-pizza',
      name: ' Пицца ',
      items: [
        {
          productId: 'p-marg',
          name: 'Маргарита',
          description: 'Томаты',
          sortOrder: 2,
          sizePrices: [
            {
              sizeId: 's-30',
              sizeName: '30 см',
              price: 60000,
              isDefault: true,
              weight: 0.45,
              measureUnitType: 'KILOGRAM',
              buttonImageUrl: 'https://img.iiko/marg.jpg',
              nutritions: { proteins: 10, fats: 8, carbs: 30, energy: 250 },
            },
            { sizeId: 's-40', sizeName: '40 см', price: 80000 },
            { sizeId: 's-50', sizeName: '50 см', price: 99000, isHidden: true },
          ],
          modifierGroups: [
            {
              id: 'mg-sauce',
              name: 'Соус',
              restrictions: { minQuantity: 1, maxQuantity: 2 },
              items: [
                { id: 'm-ketchup' },
                { id: 'm-mayo', name: 'Майонез домашний' },
                { id: 'm-hidden', isHidden: true },
              ],
            },
            { id: 'mg-empty', name: 'Пусто', items: [{ id: 'm-gone' }] },
          ],
        },
        {
          productId: 'p-delivery',
          name: 'Доставка',
          sizePrices: [{ price: 0 }],
        },
      ],
    },
    {
      id: 'g-drinks',
      name: 'Напитки',
      isHidden: true,
      items: [
        // The same product in a second group is taken once
        {
          productId: 'p-marg',
          name: 'Маргарита (дубль)',
          sizePrices: [{ price: 1 }],
        },
        {
          productId: 'p-cola',
          name: 'Кола',
          sizePrices: [
            { price: 12000, weight: 500, measureUnitType: 'MILLILITER' },
          ],
        },
        {
          productId: 'p-nosale',
          name: 'Не продаётся',
          sizePrices: [{ price: null }],
        },
        { productId: null, name: 'Без id' },
      ],
    },
  ],
  modifiers: [
    {
      id: 'm-ketchup',
      name: 'Кетчуп',
      sizePrices: [{ sizeId: null, price: 3000 }],
    },
    {
      id: 'm-mayo',
      name: 'Майонез',
      sizePrices: [
        { sizeId: 's-30', price: 4000 },
        { sizeId: null, price: 5000 },
      ],
    },
    { id: 'm-hidden', name: 'Скрытый', sizePrices: [{ price: 1 }] },
    { id: 'm-gone', name: 'Скрыт в справочнике', isHidden: true },
  ],
  products: [{ id: 'p-delivery', canSetOpenPrice: true }],
};

describe('iikoMenuToPos', () => {
  const menu = iikoMenuToPos(MENU);
  const item = (id: string) => menu.items.find((i) => i.externalId === id)!;

  it('takes the groups as categories, hidden ones flagged', () => {
    expect(menu.categories).toEqual([
      { externalId: 'g-pizza', name: 'Пицца', hidden: false },
      { externalId: 'g-drinks', name: 'Напитки', hidden: true },
    ]);
  });

  it('visible sizes become sizes priced in full; the dish costs the cheapest', () => {
    const marg = item('p-marg');
    expect(marg.price).toBe(60000);
    expect(marg.sizes).toEqual([
      { sizeId: 's-30', name: '30 см', price: 60000, isDefault: true },
      { sizeId: 's-40', name: '40 см', price: 80000, isDefault: false },
    ]);
    expect(marg.categoryExternalId).toBe('g-pizza');
    expect(marg.sortOrder).toBe(2);
  });

  it('weight, unit, nutrition and the picture come from the default size', () => {
    const marg = item('p-marg');
    expect(marg.weight).toBe(450);
    expect(marg.unit).toBe('gr');
    expect(marg.nutrition).toEqual({
      protein: 10,
      fat: 8,
      carbohydrate: 30,
      kcal: 250,
    });
    expect(marg.imageUrl).toBe('https://img.iiko/marg.jpg');
    expect(item('p-cola')).toMatchObject({
      weight: 500,
      unit: 'ml',
      sizes: [],
    });
  });

  it('modifier groups: limits, names and prices from the reference list, hidden options dropped', () => {
    expect(item('p-marg').modifierGroups).toEqual([
      {
        externalId: 'mg-sauce',
        name: 'Соус',
        min: 1,
        max: 2,
        options: [
          { externalId: 'm-ketchup', name: 'Кетчуп', price: 3000 },
          // own name overrides; the price of the default size wins over the size-less one
          { externalId: 'm-mayo', name: 'Майонез домашний', price: 4000 },
        ],
      },
    ]);
  });

  it('an item listed twice is taken once, from the first group', () => {
    expect(menu.items.filter((i) => i.externalId === 'p-marg')).toHaveLength(1);
  });

  it('an item without a price is hidden; an item without a product id is skipped', () => {
    expect(item('p-nosale').hidden).toBe(true);
    expect(menu.items.some((i) => i.name === 'Без id')).toBe(false);
  });

  it('marks the open price and leaves out the service item when asked', () => {
    expect(item('p-delivery').openPrice).toBe(true);
    expect(
      iikoMenuToPos(MENU, { serviceItemId: 'p-delivery' }).items.some(
        (i) => i.externalId === 'p-delivery',
      ),
    ).toBe(false);
  });

  it('the size an order names: one visible size is the default size, several sizes carry their own', () => {
    const one = iikoMenuToPos({
      itemsGroups: [
        {
          id: 'g',
          name: 'G',
          items: [
            {
              productId: 'p1',
              name: 'Шаурма',
              sizePrices: [
                { sizeId: 's-std', price: 30000 },
                { sizeId: 's-big', price: 40000, isHidden: true },
              ],
            },
            {
              productId: 'p2',
              name: 'Чай',
              sizePrices: [{ sizeId: null, price: 5000 }],
            },
          ],
        },
      ],
    });
    expect(one.items.map((i) => [i.externalId, i.defaultSizeId])).toEqual([
      ['p1', 's-std'],
      ['p2', null],
    ]);
    const marg = iikoMenuToPos(MENU).items.find(
      (i) => i.externalId === 'p-marg',
    )!;
    expect(marg.defaultSizeId).toBeNull();
    expect(marg.sizes.length).toBeGreaterThan(1);
  });

  it('an empty answer is an empty menu', () => {
    expect(iikoMenuToPos({})).toEqual({ categories: [], items: [] });
  });
});
