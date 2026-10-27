import { NotFoundException } from '@nestjs/common';
import { FakeMenuPrisma, seedTwoTenants } from 'src/modules/_prisma/menu-prisma.fake';
import { ProductService } from './product.service';

const NEW_DISH = {
  price: 100,
  unit: 'gr' as any,
  translations: [{ lang: 'ru', title: 'Плов' }],
};

describe('ProductService: organization ownership (IDOR)', () => {
  let db: FakeMenuPrisma;
  let t: ReturnType<typeof seedTwoTenants>;
  let files: { removeFile: jest.Mock; uploadFile: jest.Mock };
  let revalidate: { addRevalidationJob: jest.Mock };
  let service: ProductService;
  let ORG: string;

  beforeEach(() => {
    db = new FakeMenuPrisma();
    t = seedTwoTenants(db);
    ORG = t.mine.org.id;
    files = { removeFile: jest.fn(), uploadFile: jest.fn(async () => ({ id: 'file-new' })) };
    revalidate = { addRevalidationJob: jest.fn() };
    service = new ProductService(db as any, files as any, revalidate as any);
  });

  async function refused(p: Promise<unknown>) {
    await expect(p).rejects.toBeInstanceOf(NotFoundException);
    expect(db.log).toEqual([]);
    expect(revalidate.addRevalidationJob).not.toHaveBeenCalled();
    expect(files.removeFile).not.toHaveBeenCalled();
    expect(files.uploadFile).not.toHaveBeenCalled();
  }

  it('lists only my dishes', async () => {
    const list = await service.findAll(ORG, undefined as any, 'ru');
    expect(list.map((p) => p.id)).toEqual([t.mine.product.id]);
  });

  it('lists nothing of theirs even when filtering by their category', async () => {
    expect(await service.findAll(ORG, t.theirs.category.id, 'ru')).toEqual([]);
  });

  it('reads my dish and 404s on theirs', async () => {
    await expect(service.findById(t.mine.product.id, ORG)).resolves.toMatchObject({ id: t.mine.product.id });
    await refused(service.findById(t.theirs.product.id, ORG));
  });

  it('refuses to create a dish in their category', async () => {
    await refused(service.createProduct({ ...NEW_DISH, category_id: t.theirs.category.id }, ORG, 'mine'));
  });

  it('refuses to attach their option group to my new dish', async () => {
    await refused(
      service.createProduct(
        { ...NEW_DISH, category_id: t.mine.category.id, additional_product_group_ids: [t.theirs.group.id] },
        ORG,
        'mine',
      ),
    );
  });

  it('creates a dish with a group made before it (the dashboard new-dish flow)', async () => {
    const pending = db.seed('additional_product_group', { organization_id: ORG, product_id: null });
    const dish = await service.createProduct(
      { ...NEW_DISH, category_id: t.mine.category.id, additional_product_group_ids: [pending.id] },
      ORG,
      'mine',
    );
    expect(db.data.additional_product_group.find((g) => g.id === pending.id)?.product_id).toBe(dish.id);
  });

  it('refuses to update, toggle, move or delete their dish', async () => {
    await refused(service.updateProduct(t.theirs.product.id, { price: 1 }, ORG, 'mine'));
    await refused(service.updateIsActive(t.theirs.product.id, false, ORG, 'mine'));
    await refused(
      service.moveProduct(
        { productId: t.theirs.product.id, categoryId: t.theirs.category.id, newIndex: 5 },
        ORG,
        'mine',
      ),
    );
    await refused(service.delete(t.theirs.product.id, ORG, 'mine'));
    expect(db.data.product.find((p) => p.id === t.theirs.product.id)).toMatchObject({ price: 100, index: 1 });
  });

  it('refuses to reindex their category through my dish', async () => {
    await refused(
      service.moveProduct(
        { productId: t.mine.product.id, categoryId: t.theirs.category.id, newIndex: 5 },
        ORG,
        'mine',
      ),
    );
  });

  it('refuses to move my dish into their category', async () => {
    await refused(
      service.updateProduct(t.mine.product.id, { category_id: t.theirs.category.id }, ORG, 'mine'),
    );
  });

  it('refuses translation ids of their dish', async () => {
    await refused(
      service.updateProduct(
        t.mine.product.id,
        { translations: [{ id: t.theirs.productTr.id, lang: 'ru', title: 'hijack' }] },
        ORG,
        'mine',
      ),
    );
  });

  it('refuses images on their dish and deleting their image', async () => {
    await refused(service.addProductImages(t.theirs.product.id, [{} as any], ORG));
    await refused(service.deleteImage(t.theirs.image.id, ORG));
  });

  it('does not delete a file that is not a dish image', async () => {
    const logo = db.seed('file', { product_id: null, url: '/logo.png' });
    await refused(service.deleteImage(logo.id, ORG));
  });

  it('still does everything on my own dish', async () => {
    await service.updateProduct(
      t.mine.product.id,
      { price: 120, translations: [{ id: t.mine.productTr.id, lang: 'ru', title: 'Новый плов' }] },
      ORG,
      'mine',
    );
    await service.updateIsActive(t.mine.product.id, false, ORG, 'mine');
    await service.moveProduct(
      { productId: t.mine.product.id, categoryId: t.mine.category.id, newIndex: 3 },
      ORG,
      'mine',
    );
    await service.deleteImage(t.mine.image.id, ORG);
    expect(files.removeFile).toHaveBeenCalledWith(t.mine.image.id);
    expect(db.data.product.find((p) => p.id === t.mine.product.id)).toMatchObject({
      price: 120,
      is_active: false,
      index: 3,
    });
    await service.delete(t.mine.product.id, ORG, 'mine');
    expect(db.data.product.some((p) => p.id === t.mine.product.id)).toBe(false);
  });
});
