import type { PosMenu, PosMenuItem } from '../provider/pos-provider';
import { planMenuImport, PlanInput } from './menu-import-plan';

const item = (
  externalId: string,
  name: string,
  extra: Partial<PosMenuItem> = {},
): PosMenuItem => ({
  externalId,
  categoryExternalId: 'g1',
  name,
  description: null,
  hidden: false,
  sortOrder: 0,
  price: 100,
  sizes: [],
  modifierGroups: [],
  weight: null,
  unit: 'gr',
  nutrition: { protein: null, fat: null, carbohydrate: null, kcal: null },
  imageUrl: null,
  openPrice: false,
  ...extra,
});

const menu = (items: PosMenuItem[]): PosMenu => ({
  categories: [{ externalId: 'g1', name: 'Горячее', hidden: false }],
  items,
});

const base = (over: Partial<PlanInput>): PlanInput => ({
  menu: menu([]),
  serviceItemId: null,
  links: [],
  unlinkedProducts: [],
  unlinkedCategories: [],
  ownerImageProductIds: new Set(),
  ...over,
});

describe('planMenuImport', () => {
  it('first import: pairs dishes and categories by exact name, creates the rest, hides dishes without a pair', () => {
    const plan = planMenuImport(
      base({
        menu: menu([item('i-plov', 'Плов'), item('i-lag', 'Лагман')]),
        unlinkedProducts: [
          { id: 'p-plov', title: ' Плов ', hasOwnerImage: false },
          { id: 'p-old', title: 'Шашлык', hasOwnerImage: false },
        ],
        unlinkedCategories: [{ id: 'c1', title: 'Горячее' }],
      }),
    );
    expect(plan.categories[0]).toMatchObject({ targetId: 'c1', linkId: null });
    expect(plan.products.map((p) => [p.source.externalId, p.targetId])).toEqual(
      [
        ['i-plov', 'p-plov'],
        ['i-lag', null],
      ],
    );
    expect(plan.pairs).toEqual([
      { productId: 'p-plov', itemId: 'i-plov', byName: true },
    ]);
    expect(plan.hideProducts).toEqual(['p-old']);
  });

  it("the owner's pairs win over the name, and a null pair hides the dish", () => {
    const plan = planMenuImport(
      base({
        menu: menu([item('i-plov', 'Плов'), item('i-lag', 'Лагман')]),
        unlinkedProducts: [
          { id: 'p-plov', title: 'Плов', hasOwnerImage: false },
          { id: 'p-noodles', title: 'Лапша', hasOwnerImage: false },
        ],
        matches: [
          { productId: 'p-noodles', itemId: 'i-lag' },
          { productId: 'p-plov', itemId: null },
        ],
      }),
    );
    expect(plan.pairs).toEqual([
      { productId: 'p-noodles', itemId: 'i-lag', byName: false },
    ]);
    expect(plan.hideProducts).toEqual(['p-plov']);
    expect(
      plan.products.find((p) => p.source.externalId === 'i-plov')!.targetId,
    ).toBeNull();
  });

  it('one position pairs with one dish only (two dishes with the same name)', () => {
    const plan = planMenuImport(
      base({
        menu: menu([item('i-plov', 'Плов')]),
        unlinkedProducts: [
          { id: 'a', title: 'Плов', hasOwnerImage: false },
          { id: 'b', title: 'Плов', hasOwnerImage: false },
        ],
      }),
    );
    expect(plan.pairs.map((p) => p.productId)).toEqual(['a']);
    expect(plan.hideProducts).toEqual(['b']);
  });

  it('a later import updates linked rows (no duplicates), flags renamed ones and hides the gone ones', () => {
    const plan = planMenuImport(
      base({
        menu: menu([item('i-plov', 'Плов узбекский')]),
        links: [
          {
            id: 'l-cat',
            kind: 'category',
            externalId: 'g1',
            rowId: 'c1',
            sourceName: 'Горячее',
            sourceImageUrl: null,
          },
          {
            id: 'l-plov',
            kind: 'product',
            externalId: 'i-plov',
            rowId: 'p-plov',
            sourceName: 'Плов',
            sourceImageUrl: null,
          },
          {
            id: 'l-gone',
            kind: 'product',
            externalId: 'i-gone',
            rowId: 'p-gone',
            sourceName: 'Сомса',
            sourceImageUrl: null,
          },
        ],
      }),
    );
    expect(plan.categories[0]).toMatchObject({
      targetId: 'c1',
      linkId: 'l-cat',
      nameChanged: false,
    });
    expect(plan.products).toHaveLength(1);
    expect(plan.products[0]).toMatchObject({
      targetId: 'p-plov',
      linkId: 'l-plov',
      nameChanged: true,
    });
    expect(plan.goneLinks).toEqual(['l-gone']);
    expect(plan.pairs).toEqual([]);
  });

  it('the service item "Delivery" never reaches the menu', () => {
    const plan = planMenuImport(
      base({
        menu: menu([item('i-plov', 'Плов'), item('i-dlv', 'Доставка')]),
        serviceItemId: 'i-dlv',
        unlinkedProducts: [
          { id: 'p-dlv', title: 'Доставка', hasOwnerImage: false },
        ],
      }),
    );
    expect(plan.products.map((p) => p.source.externalId)).toEqual(['i-plov']);
    expect(plan.hideProducts).toEqual(['p-dlv']);
  });

  describe('pictures', () => {
    const withImage = item('i-plov', 'Плов', {
      imageUrl: 'https://img/plov.jpg',
    });

    it('copies a new POS picture', () => {
      const plan = planMenuImport(base({ menu: menu([withImage]) }));
      expect(plan.products[0].downloadImage).toBe('https://img/plov.jpg');
    });

    it('does not copy the same picture again', () => {
      const plan = planMenuImport(
        base({
          menu: menu([withImage]),
          links: [
            {
              id: 'l',
              kind: 'product',
              externalId: 'i-plov',
              rowId: 'p',
              sourceName: 'Плов',
              sourceImageUrl: 'https://img/plov.jpg',
            },
          ],
        }),
      );
      expect(plan.products[0].downloadImage).toBeNull();
    });

    it("keeps the owner's picture (linked or paired now)", () => {
      const linked = planMenuImport(
        base({
          menu: menu([withImage]),
          links: [
            {
              id: 'l',
              kind: 'product',
              externalId: 'i-plov',
              rowId: 'p',
              sourceName: 'Плов',
              sourceImageUrl: null,
            },
          ],
          ownerImageProductIds: new Set(['p']),
        }),
      );
      expect(linked.products[0].downloadImage).toBeNull();
      const paired = planMenuImport(
        base({
          menu: menu([withImage]),
          unlinkedProducts: [{ id: 'p', title: 'Плов', hasOwnerImage: true }],
        }),
      );
      expect(paired.products[0].downloadImage).toBeNull();
    });
  });
});
