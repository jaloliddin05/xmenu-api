import {
  FakeMenuPrisma,
  seedTwoTenants,
} from 'src/modules/_prisma/menu-prisma.fake';
import { MenuService } from './menu.service';

const LOCALE = { lang: 'ru', fallback: 'ru', currency: 'UZS' } as const;

describe('MenuService: dishes the POS takes out of the menu', () => {
  let db: FakeMenuPrisma;
  let t: ReturnType<typeof seedTwoTenants>;
  let service: MenuService;
  let pos: { id: string; status: string };
  let second: { id: string };

  beforeEach(() => {
    db = new FakeMenuPrisma();
    t = seedTwoTenants(db);
    service = new MenuService(db as any);
    second = db.seed('product', {
      category_id: t.mine.category.id,
      price: 5,
      is_active: true,
    });
    db.seed('product_translation', {
      product_id: second.id,
      lang: 'ru',
      title: 'Чай',
    });
    pos = db.seed('pos_integration', {
      organization_id: t.mine.org.id,
      status: 'active',
    });
    for (const branch of ['b1', 'b2'])
      db.seed('pos_branch_link', { integration_id: pos.id, branch_id: branch });
  });

  const dishes = async (branchId?: string) =>
    (await service.getMenu(t.mine.org.id, LOCALE as any, branchId)).flatMap(
      (c: any) => c.items.map((p: any) => p.name),
    );

  it('without a POS the menu is as before', async () => {
    expect(await dishes()).toEqual(['Mine dish', 'Чай']);
  });

  it('a dish gone from the POS (or hidden there) is not shown', async () => {
    db.seed('pos_menu_link', {
      integration_id: pos.id,
      kind: 'product',
      product_id: second.id,
      hidden_in_pos: true,
    });
    expect(await dishes()).toEqual(['Mine dish']);
  });

  it('a category hidden in the POS is not shown', async () => {
    db.seed('pos_menu_link', {
      integration_id: pos.id,
      kind: 'category',
      category_id: t.mine.category.id,
      hidden_in_pos: true,
    });
    expect(await dishes()).toEqual([]);
  });

  it('stopped in one branch: still in the venue menu, not in that branch', async () => {
    db.seed('pos_stop_item', {
      integration_id: pos.id,
      branch_id: 'b1',
      product_id: second.id,
    });
    expect(await dishes()).toEqual(['Mine dish', 'Чай']);
    expect(await dishes('b1')).toEqual(['Mine dish']);
    expect(await dishes('b2')).toEqual(['Mine dish', 'Чай']);
  });

  it('stopped in every linked branch: out of the venue menu', async () => {
    for (const branch of ['b1', 'b2'])
      db.seed('pos_stop_item', {
        integration_id: pos.id,
        branch_id: branch,
        product_id: second.id,
      });
    expect(await dishes()).toEqual(['Mine dish']);
  });

  it('a draft integration (not enabled) changes nothing', async () => {
    pos.status = 'draft';
    for (const branch of ['b1', 'b2'])
      db.seed('pos_stop_item', {
        integration_id: pos.id,
        branch_id: branch,
        product_id: second.id,
      });
    expect(await dishes()).toEqual(['Mine dish', 'Чай']);
  });
});
