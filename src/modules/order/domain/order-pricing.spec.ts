import { CustomerAuthException } from 'src/modules/auth/errors/customer-auth.exception';
import { PricingProduct, priceLines } from './order-pricing';

const tr = (title: string) => [{ lang: 'ru', title, description: null }];

const manti = (over: Record<string, unknown> = {}): PricingProduct =>
  ({
    id: 'p1', is_active: true, price: 45000, weight: 800, unit: 'gr',
    translations: tr('Мант'), images: [{ url: '/m.png' }], category: { is_active: true },
    additional_product_groups: [
      {
        id: 'g1', is_required: true, is_multiple: true, min_selected: 2, max_selected: 3, translations: tr('Добавки'),
        additional_products: [
          { id: 'o1', price: 3500, translations: tr('Катык') },
          { id: 'o2', price: 0, translations: tr('Лазжон') },
          { id: 'o3', price: 1000, translations: tr('Сметана') },
        ],
      },
      {
        id: 'g2', is_required: false, is_multiple: false, min_selected: null, max_selected: null, translations: tr('Сироп'),
        additional_products: [{ id: 'o4', price: 2000, translations: tr('Мёд') }, { id: 'o5', price: 2500, translations: tr('Джем') }],
      },
    ],
    ...over,
  }) as unknown as PricingProduct;

const plain = (): PricingProduct =>
  ({ id: 'p2', is_active: true, price: 15000.4, weight: null, unit: 'gr', translations: tr('Фри'), images: [], category: { is_active: true }, additional_product_groups: [] }) as unknown as PricingProduct;

const catalog = (...ps: PricingProduct[]) => new Map(ps.map((p) => [p.id, p]));

function thrown(fn: () => unknown): CustomerAuthException {
  try {
    fn();
  } catch (e) {
    return e as CustomerAuthException;
  }
  throw new Error('expected to throw');
}

describe('priceLines', () => {
  it('prices from the database: base + options, × quantity', () => {
    const { lines, subtotal } = priceLines(
      [
        { itemId: 'p1', quantity: 2, modifiers: [{ groupId: 'g1', optionIds: ['o1', 'o2'] }, { groupId: 'g2', optionIds: ['o4'] }] },
        { itemId: 'p2', quantity: 3 },
      ],
      catalog(manti(), plain()),
      'ru',
      'ru',
    );
    expect(lines[0]).toMatchObject({ productId: 'p1', name: 'Мант', weight: '800 г', basePrice: 45000, unitPrice: 45000 + 3500 + 0 + 2000, quantity: 2, position: 0 });
    expect(lines[1]).toMatchObject({ productId: 'p2', unitPrice: 15000, quantity: 3, image: null }); // fractional price rounded
    expect(subtotal).toBe(50500 * 2 + 15000 * 3);
  });

  it('options are recorded in database order, not request order', () => {
    const { lines } = priceLines([{ itemId: 'p1', quantity: 1, modifiers: [{ groupId: 'g1', optionIds: ['o2', 'o1'] }] }], catalog(manti()), 'ru', 'ru');
    expect(lines[0].options.map((o) => o.optionId)).toEqual(['o1', 'o2']);
    expect(lines[0].options.map((o) => o.position)).toEqual([0, 1]);
  });

  it('missing / inactive product / inactive category → item_unavailable listing every bad index', () => {
    const e = thrown(() =>
      priceLines(
        [{ itemId: 'zzz', quantity: 1 }, { itemId: 'p2', quantity: 1 }, { itemId: 'p3', quantity: 1 }, { itemId: 'p4', quantity: 1 }],
        catalog(plain(), { ...plain(), id: 'p3', is_active: false } as any, { ...plain(), id: 'p4', category: { is_active: false } } as any),
        'ru',
        'ru',
      ),
    );
    expect(e.code).toBe('item_unavailable');
    expect((e.details!.items as any[]).map((i) => i.index)).toEqual([0, 2, 3]);
  });

  it('a product with NULL is_active (legacy rows) is available', () => {
    expect(() => priceLines([{ itemId: 'p2', quantity: 1 }], catalog({ ...plain(), is_active: null } as any), 'ru', 'ru')).not.toThrow();
  });

  describe('invalid modifiers', () => {
    const run = (modifiers: any) => thrown(() => priceLines([{ itemId: 'p1', quantity: 1, modifiers }], catalog(manti()), 'ru', 'ru'));
    const reason = (modifiers: any) => (run(modifiers).details!.items as any[])[0].reason;
    const ok = [{ groupId: 'g1', optionIds: ['o1', 'o2'] }];

    it('required group not chosen', () => expect(reason([])).toBe('missing_required'));
    it('fewer than min', () => expect(reason([{ groupId: 'g1', optionIds: ['o1'] }])).toBe('below_min'));
    it('more than max', () => expect(reason([{ groupId: 'g1', optionIds: ['o1', 'o2', 'o3', 'o3'] }])).toBe('duplicate_option'));
    it('single-choice group with two options', () => expect(reason([...ok, { groupId: 'g2', optionIds: ['o4', 'o5'] }])).toBe('above_max'));
    it('unknown group', () => expect(reason([...ok, { groupId: 'nope', optionIds: ['o4'] }])).toBe('unknown_group'));
    it('option from another group', () => expect(reason([{ groupId: 'g1', optionIds: ['o1', 'o4'] }])).toBe('unknown_option'));
    it('same group twice', () => expect(reason([...ok, ...ok])).toBe('duplicate_group'));
    it('reports the group', () => expect((run([]).details!.items as any[])[0]).toMatchObject({ index: 0, itemId: 'p1', groupId: 'g1' }));
    it('is a 422', () => expect(run([]).getStatus()).toBe(422));
  });

  it.each([0, -1, 51, 1.5, NaN])('quantity %p is invalid_order', (quantity) => {
    expect(thrown(() => priceLines([{ itemId: 'p2', quantity }], catalog(plain()), 'ru', 'ru')).code).toBe('invalid_order');
  });
});
