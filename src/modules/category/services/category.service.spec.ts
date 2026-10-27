import { NotFoundException } from '@nestjs/common';
import { FakeMenuPrisma, seedTwoTenants } from 'src/modules/_prisma/menu-prisma.fake';
import { CategoryService } from './category.service';

const TR = [{ lang: 'ru', title: 'Супы' }];

describe('CategoryService: organization ownership (IDOR)', () => {
  let db: FakeMenuPrisma;
  let t: ReturnType<typeof seedTwoTenants>;
  let revalidate: { addRevalidationJob: jest.Mock };
  let service: CategoryService;
  let ORG: string;

  beforeEach(() => {
    db = new FakeMenuPrisma();
    t = seedTwoTenants(db);
    ORG = t.mine.org.id;
    revalidate = { addRevalidationJob: jest.fn() };
    service = new CategoryService(db as any, revalidate as any);
  });

  async function refused(p: Promise<unknown>) {
    await expect(p).rejects.toBeInstanceOf(NotFoundException);
    expect(db.log).toEqual([]);
    expect(revalidate.addRevalidationJob).not.toHaveBeenCalled();
  }

  it('creates in my organization, with or without the legacy organization_id', async () => {
    const a = await service.createCategory({ translations: TR }, ORG, 'mine');
    const b = await service.createCategory({ translations: TR, organization_id: ORG }, ORG, 'mine');
    for (const c of [a, b]) {
      expect(db.data.category.find((r) => r.id === c.id)?.organization_id).toBe(ORG);
    }
  });

  it('refuses to create a category in their organization', async () => {
    await refused(service.createCategory({ translations: TR, organization_id: t.theirs.org.id }, ORG, 'mine'));
    expect(db.data.category.filter((c) => c.organization_id === t.theirs.org.id)).toHaveLength(1);
  });

  it('lists and reads only mine', async () => {
    expect((await service.findAll('ru', ORG)).map((c) => c.id)).toEqual([t.mine.category.id]);
    await expect(service.findOne(t.mine.category.id, ORG)).resolves.toMatchObject({ id: t.mine.category.id });
    await refused(service.findOne(t.theirs.category.id, ORG));
  });

  it('for-select accepts only my organization id', async () => {
    await expect(service.getForSelect(ORG, ORG, 'ru')).resolves.toEqual([
      { id: t.mine.category.id, title: 'Mine cat' },
    ]);
    await refused(service.getForSelect(t.theirs.org.id, ORG, 'ru'));
  });

  it('refuses to update, toggle or delete their category', async () => {
    await refused(service.update(t.theirs.category.id, { translations: TR } as any, ORG, 'mine'));
    await refused(service.update(t.theirs.category.id, {} as any, ORG, 'mine'));
    await refused(service.updateIsActive(t.theirs.category.id, false, ORG, 'mine'));
    await refused(service.delete(t.theirs.category.id, ORG, 'mine'));
    expect(db.data.category_translation.find((r) => r.id === t.theirs.categoryTr.id)?.title).toBe('Theirs cat');
  });

  it('refuses to reindex their categories', async () => {
    await refused(service.moveCategory({ categoryId: t.theirs.category.id, newIndex: 5 }, ORG, 'mine'));
    await refused(
      service.moveCategory(
        { categoryId: t.mine.category.id, organizationId: t.theirs.org.id, newIndex: 5 },
        ORG,
        'mine',
      ),
    );
  });

  it('still manages my own category', async () => {
    await service.update(t.mine.category.id, { translations: [{ lang: 'ru', title: 'Новое' }] } as any, ORG, 'mine');
    expect(db.data.category_translation.find((r) => r.id === t.mine.categoryTr.id)?.title).toBe('Новое');
    await service.updateIsActive(t.mine.category.id, false, ORG, 'mine');
    await service.moveCategory({ categoryId: t.mine.category.id, organizationId: ORG, newIndex: 4 }, ORG, 'mine');
    expect(db.data.category.find((r) => r.id === t.mine.category.id)).toMatchObject({ is_active: false, index: 4 });
    // Their category indexes were not touched by my reindex
    expect(db.data.category.find((r) => r.id === t.theirs.category.id)?.index).toBe(1);
    await service.delete(t.mine.category.id, ORG, 'mine');
    expect(db.data.category.some((r) => r.id === t.mine.category.id)).toBe(false);
  });
});
