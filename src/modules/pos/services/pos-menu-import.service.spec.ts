import { AppException } from 'src/infra/errors/app-exception';
import {
  FakeMenuPrisma,
  seedTwoTenants,
} from 'src/modules/_prisma/menu-prisma.fake';
import type { PosMenu, PosMenuItem } from '../provider/pos-provider';
import { PosMenuImportService } from './pos-menu-import.service';

const item = (
  externalId: string,
  name: string,
  extra: Partial<PosMenuItem> = {},
): PosMenuItem => ({
  externalId,
  categoryExternalId: 'g-hot',
  name,
  description: null,
  hidden: false,
  sortOrder: 1,
  price: 50000,
  sizes: [],
  modifierGroups: [],
  weight: 300,
  unit: 'gr',
  nutrition: { protein: null, fat: null, carbohydrate: null, kcal: null },
  imageUrl: null,
  openPrice: false,
  ...extra,
});

describe('PosMenuImportService', () => {
  let db: FakeMenuPrisma;
  let t: ReturnType<typeof seedTwoTenants>;
  let menu: PosMenu;
  let provider: { fetchMenu: jest.Mock };
  let images: { fetch: jest.Mock };
  let revalidate: { addRevalidationJob: jest.Mock };
  let alerts: Record<string, jest.Mock>;
  let service: PosMenuImportService;
  let row: any;

  beforeEach(() => {
    db = new FakeMenuPrisma();
    t = seedTwoTenants(db);
    row = db.seed('pos_integration', {
      organization_id: t.mine.org.id,
      status: 'draft',
      api_key_encrypted: 'enc',
      external_org_id: 'o1',
      external_menu_id: 'm1',
      price_category_id: null,
      delivery_item_id: 'i-dlv',
      source_lang: 'ru',
    });
    menu = {
      categories: [{ externalId: 'g-hot', name: 'Горячее', hidden: false }],
      items: [
        // Same name as the seeded dish: paired, not duplicated
        item('i-mine', 'Mine dish', {
          sizes: [
            { sizeId: 's1', name: 'Малая', price: 50000, isDefault: true },
            { sizeId: 's2', name: 'Большая', price: 70000, isDefault: false },
          ],
          modifierGroups: [
            {
              externalId: 'mg1',
              name: 'Соус',
              min: 0,
              max: 2,
              options: [{ externalId: 'm1', name: 'Кетчуп', price: 3000 }],
            },
          ],
        }),
        item('i-new', 'Лагман', { imageUrl: 'https://img/lagman.jpg' }),
        item('i-dlv', 'Доставка', { price: 0 }),
      ],
    };
    provider = { fetchMenu: jest.fn(async () => menu) };
    images = {
      fetch: jest.fn(async () => ({
        url: '/image/products/pos/abc.jpg',
        path: 'uploads/image/products/pos/abc.jpg',
        hash: 'abc',
      })),
    };
    revalidate = { addRevalidationJob: jest.fn(async () => undefined) };
    alerts = {
      raise: jest.fn(async () => undefined),
      needsReconnect: jest.fn(async () => undefined),
      clear: jest.fn(async () => undefined),
      keyRejected: jest.fn(async () => false),
      platform: jest.fn(async () => undefined),
    };
    service = new PosMenuImportService(
      db as any,
      provider as any,
      { credentials: () => ({ integrationId: row.id, apiKey: 'k' }) } as any,
      images as any,
      revalidate as any,
      alerts as any,
    );
  });

  /** The first connection (enable) pairs; the schedule and the button do not */
  const firstImport = () => service.import(row, { pairing: true });

  const links = (kind: string) =>
    db.data.pos_menu_link.filter((l) => l.kind === kind);
  const myProducts = () =>
    db.data.product.filter((p) =>
      db.data.category.some(
        (c) => c.id === p.category_id && c.organization_id === t.mine.org.id,
      ),
    );

  it('first import: pairs by name, creates the new dish, keeps the service item out, revalidates', async () => {
    await firstImport();
    expect(links('product').map((l) => [l.external_id, l.product_id])).toEqual([
      ['i-mine', t.mine.product.id],
      ['i-new', expect.any(String)],
    ]);
    expect(myProducts()).toHaveLength(2);
    expect(
      db.data.product_translation.some((tr) => tr.title === 'Доставка'),
    ).toBe(false);
    const paired = db.data.product.find((p) => p.id === t.mine.product.id)!;
    expect(paired).toMatchObject({ price: 50000, weight: 300 });
    expect(row.menu_imported_at).toBeInstanceOf(Date);
    expect(row.menu_import_error).toBeNull();
    expect(revalidate.addRevalidationJob).toHaveBeenCalledWith({
      tenantId: t.mine.org.id,
      route: 'menu',
    });
    // The other venue is untouched
    expect(
      db.data.product.find((p) => p.id === t.theirs.product.id)!.price,
    ).toBe(100);
  });

  it('sizes become a required single-choice group priced as surcharges; the old groups of a paired dish go', async () => {
    await firstImport();
    const groups = db.data.additional_product_group.filter(
      (g) => g.product_id === t.mine.product.id,
    );
    expect(groups.map((g) => g.id)).not.toContain(t.mine.group.id);
    const sizeLink = links('size_group')[0];
    const sizeGroup = groups.find((g) => g.id === sizeLink.group_id)!;
    expect(sizeGroup).toMatchObject({
      is_required: true,
      is_multiple: false,
      min_selected: 1,
      max_selected: 1,
    });
    const sizes = links('size').map((l) => [
      l.size_id,
      db.data.additional_product.find((o) => o.id === l.option_id)!.price,
    ]);
    expect(sizes).toEqual([
      ['s1', 0],
      ['s2', 20000],
    ]);
    expect(
      db.data.additional_product_group_translation.find(
        (tr) => tr.additional_product_group_id === sizeGroup.id,
      )!.title,
    ).toBe('Размер');
    expect(links('modifier').map((l) => l.external_id)).toEqual([
      'i-mine/mg1/m1',
    ]);
  });

  it('a second import updates the linked rows and creates nothing new', async () => {
    await firstImport();
    const counts = () => [
      db.data.product.length,
      db.data.category.length,
      db.data.additional_product_group.length,
      db.data.additional_product.length,
      db.data.pos_menu_link.length,
    ];
    const before = counts();
    menu.items[1] = { ...menu.items[1], price: 61000 };
    await service.import(row);
    expect(counts()).toEqual(before);
    const lagman = links('product').find((l) => l.external_id === 'i-new')!;
    expect(db.data.product.find((p) => p.id === lagman.product_id)!.price).toBe(
      61000,
    );
  });

  it('a name changed in the POS rewrites the POS language and marks the other translations stale', async () => {
    await firstImport();
    const id = t.mine.product.id;
    db.seed('product_translation', {
      product_id: id,
      lang: 'uz',
      title: 'Mening taomim',
      stale: false,
    });
    menu.items[0] = { ...menu.items[0], name: 'Mine dish XL' };
    await service.import(row);
    const tr = db.data.product_translation.filter((x) => x.product_id === id);
    expect(tr.find((x) => x.lang === 'ru')!.title).toBe('Mine dish XL');
    expect(tr.find((x) => x.lang === 'uz')!.stale).toBe(true);
  });

  it('a dish gone from the POS is hidden through its link; a dish without a pair is hidden, not deleted', async () => {
    const extra = db.seed('product', {
      category_id: t.mine.category.id,
      price: 1,
      is_active: true,
    });
    db.seed('product_translation', {
      product_id: extra.id,
      lang: 'ru',
      title: 'Нет в iiko',
    });
    await firstImport();
    expect(db.data.product.find((p) => p.id === extra.id)!.is_active).toBe(
      false,
    );

    menu.items = menu.items.filter((i) => i.externalId !== 'i-new');
    await service.import(row);
    expect(
      links('product').find((l) => l.external_id === 'i-new')!.hidden_in_pos,
    ).toBe(true);
  });

  it('pictures: copied once, not again for the same address, never over the owner picture', async () => {
    await firstImport();
    expect(images.fetch).toHaveBeenCalledTimes(1);
    const lagman = links('product').find((l) => l.external_id === 'i-new')!;
    expect(lagman.source_image_url).toBe('https://img/lagman.jpg');
    expect(
      db.data.file.filter(
        (f) => f.product_id === lagman.product_id && f.from_pos,
      ),
    ).toHaveLength(1);
    await service.import(row);
    expect(images.fetch).toHaveBeenCalledTimes(1);

    // The seeded dish has an owner upload: the POS picture does not replace it
    menu.items[0] = { ...menu.items[0], imageUrl: 'https://img/mine.jpg' };
    await service.import(row);
    expect(images.fetch).toHaveBeenCalledTimes(1);
  });

  it('a picture that fails is skipped; the import still succeeds', async () => {
    images.fetch.mockRejectedValueOnce(new Error('timeout'));
    await firstImport();
    const lagman = links('product').find((l) => l.external_id === 'i-new')!;
    expect(lagman.source_image_url).toBeUndefined();
    expect(row.menu_import_error).toBeNull();
  });

  it('a failed import changes nothing and records the reason', async () => {
    provider.fetchMenu.mockRejectedValueOnce(
      new AppException('pos_unavailable'),
    );
    const writes = db.log.length;
    await expect(service.import(row)).rejects.toMatchObject({
      code: 'pos_unavailable',
    });
    expect(
      db.log.slice(writes).filter((w) => w.table !== 'pos_integration'),
    ).toEqual([]);
    expect(row.menu_import_error).toBe('pos_unavailable');
    expect(revalidate.addRevalidationJob).not.toHaveBeenCalled();
  });

  it('a revoked key marks an enabled integration for reconnecting and alerts the owner', async () => {
    row.status = 'active';
    provider.fetchMenu.mockRejectedValueOnce(
      new AppException('pos_key_invalid'),
    );
    await expect(service.import(row)).rejects.toMatchObject({
      code: 'pos_key_invalid',
    });
    expect(alerts.needsReconnect).toHaveBeenCalledWith(row);
  });

  it('keys of several venues rejected at once: the platform, no venue reconnects', async () => {
    row.status = 'active';
    alerts.keyRejected.mockResolvedValueOnce(true);
    provider.fetchMenu.mockRejectedValueOnce(
      new AppException('pos_key_invalid'),
    );
    await expect(service.import(row)).rejects.toMatchObject({
      code: 'pos_key_invalid',
    });
    expect(row.status).toBe('active');
    expect(alerts.needsReconnect).not.toHaveBeenCalled();
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('the platform application rejected: the platform alarm, the venue keeps its status', async () => {
    row.status = 'active';
    provider.fetchMenu.mockRejectedValueOnce(
      new AppException('platform_misconfigured', {
        details: { feature: 'pos' },
      }),
    );
    await expect(service.import(row)).rejects.toMatchObject({
      code: 'platform_misconfigured',
    });
    expect(row.status).toBe('active');
    expect(alerts.platform).toHaveBeenCalledTimes(1);
    expect(alerts.raise).not.toHaveBeenCalled();
    expect(alerts.keyRejected).not.toHaveBeenCalled();
  });

  it('a failed import of an enabled integration alerts the owner; a success ends the alert', async () => {
    row.status = 'active';
    provider.fetchMenu.mockRejectedValueOnce(
      new AppException('pos_unavailable'),
    );
    await expect(service.import(row)).rejects.toMatchObject({
      code: 'pos_unavailable',
    });
    expect(alerts.raise).toHaveBeenCalledWith(row, 'menu_import_failed');
    await service.import(row);
    expect(alerts.clear).toHaveBeenCalledWith(row.id, 'menu_import_failed');
  });

  it('before enabling a failure is only answered: no alert', async () => {
    provider.fetchMenu.mockRejectedValueOnce(
      new AppException('pos_unavailable'),
    );
    await expect(firstImport()).rejects.toMatchObject({
      code: 'pos_unavailable',
    });
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('a regular import leaves a dish the owner has without a link: not hidden, not paired by name', async () => {
    row.status = 'active';
    await firstImport();
    const own = db.seed('product', {
      category_id: t.mine.category.id,
      price: 1,
      is_active: true,
    });
    db.seed('product_translation', {
      product_id: own.id,
      lang: 'ru',
      title: 'Шурпа',
    });
    menu.items.push(item('i-shurpa', 'Шурпа'));
    await service.import(row);
    expect(db.data.product.find((p) => p.id === own.id)!.is_active).toBe(true);
    const shurpa = links('product').find((l) => l.external_id === 'i-shurpa')!;
    expect(shurpa.product_id).not.toBe(own.id);
  });

  it('"match again" pairs by name as on the first connection', async () => {
    row.status = 'active';
    await firstImport();
    const own = db.seed('product', {
      category_id: t.mine.category.id,
      price: 1,
      is_active: true,
    });
    db.seed('product_translation', {
      product_id: own.id,
      lang: 'ru',
      title: 'Шурпа',
    });
    menu.items.push(item('i-shurpa', 'Шурпа'));
    await service.import(row, { pairing: true });
    expect(
      links('product').find((l) => l.external_id === 'i-shurpa')!.product_id,
    ).toBe(own.id);
  });

  it('writes under the integration lock; disconnected while the menu was fetched: nothing is written', async () => {
    await firstImport();
    expect(db.raw.map((r) => r.values)).toEqual([[`pos:${row.id}`]]);

    row.status = 'active';
    provider.fetchMenu.mockImplementationOnce(async () => {
      row.status = 'disconnected';
      return menu;
    });
    menu.items[1] = { ...menu.items[1], price: 99000 };
    const writes = db.log.length;
    await service.import(row);
    expect(db.log.slice(writes)).toEqual([]);
    expect(revalidate.addRevalidationJob).toHaveBeenCalledTimes(1);
  });

  it('preview: the pairs, the new positions and the dishes that will be hidden', async () => {
    const extra = db.seed('product', {
      category_id: t.mine.category.id,
      price: 1,
    });
    db.seed('product_translation', {
      product_id: extra.id,
      lang: 'ru',
      title: 'Нет в iiko',
    });
    const preview = await service.preview(row);
    expect(preview).toEqual({
      pairs: [
        {
          productId: t.mine.product.id,
          productTitle: 'Mine dish',
          itemId: 'i-mine',
          itemName: 'Mine dish',
          byName: true,
        },
      ],
      newItems: [{ itemId: 'i-new', name: 'Лагман' }],
      unmatched: [{ productId: extra.id, title: 'Нет в iiko' }],
    });
    expect(db.data.pos_menu_link).toEqual([]);
  });
});
