import { NotFoundException } from '@nestjs/common';
import {
  FakeMenuPrisma,
  seedTwoTenants,
} from 'src/modules/_prisma/menu-prisma.fake';
import { AdditionalProductService } from './additional-product.service';

const TR = [{ lang: 'ru', title: 'Соус' }];

describe('AdditionalProductService: organization ownership (IDOR)', () => {
  let db: FakeMenuPrisma;
  let t: ReturnType<typeof seedTwoTenants>;
  let revalidate: { addRevalidationJob: jest.Mock };
  let service: AdditionalProductService;
  let ORG: string;

  beforeEach(() => {
    db = new FakeMenuPrisma();
    t = seedTwoTenants(db);
    ORG = t.mine.org.id;
    revalidate = { addRevalidationJob: jest.fn() };
    service = new AdditionalProductService(db as any, revalidate as any);
  });

  async function refused(p: Promise<unknown>) {
    await expect(p).rejects.toBeInstanceOf(NotFoundException);
    expect(db.log).toEqual([]);
    expect(revalidate.addRevalidationJob).not.toHaveBeenCalled();
  }

  describe('groups', () => {
    it('creates a group on my product', async () => {
      const g = await service.createGroup(
        { product_id: t.mine.product.id, is_multiple: true, translations: TR },
        ORG,
        'mine',
      );
      expect(
        db.data.additional_product_group.find((r) => r.id === g.id)?.product_id,
      ).toBe(t.mine.product.id);
      expect(revalidate.addRevalidationJob).toHaveBeenCalledWith({
        tenantId: t.mine.org.id,
        route: 'menu',
        slug: 'mine',
      });
    });

    it('refuses to create a group on someone else’s product', async () => {
      await refused(
        service.createGroup(
          {
            product_id: t.theirs.product.id,
            is_multiple: true,
            translations: TR,
          },
          ORG,
          'mine',
        ),
      );
    });

    it('refuses to update, move or delete someone else’s group', async () => {
      await refused(
        service.updateGroup(
          t.theirs.group.id,
          { is_required: true },
          ORG,
          'mine',
        ),
      );
      await refused(service.deleteGroup(t.theirs.group.id, ORG, 'mine'));
    });

    it('refuses to move my group onto someone else’s product', async () => {
      await refused(
        service.updateGroup(
          t.mine.group.id,
          { product_id: t.theirs.product.id },
          ORG,
          'mine',
        ),
      );
    });

    it('refuses translation ids of another group', async () => {
      await refused(
        service.updateGroup(
          t.mine.group.id,
          {
            translations: [
              { id: t.theirs.groupTr.id, lang: 'ru', title: 'hijack' },
            ],
          },
          ORG,
          'mine',
        ),
      );
      expect(
        db.data.additional_product_group_translation.find(
          (r) => r.id === t.theirs.groupTr.id,
        )?.title,
      ).toBe('Theirs sauces');
    });

    it('treats a legacy group without an owner as nobody’s', async () => {
      const orphan = db.seed('additional_product_group', {
        product_id: null,
        organization_id: null,
      });
      await refused(service.deleteGroup(orphan.id, ORG, 'mine'));
    });

    it('a group made before its dish belongs to me and takes options', async () => {
      const g = await service.createGroup(
        { is_multiple: false, translations: TR },
        ORG,
        'mine',
      );
      const row = db.data.additional_product_group.find((r) => r.id === g.id)!;
      expect(row.organization_id).toBe(ORG);
      expect(row.product_id ?? null).toBeNull();
      // Nothing public changed yet, so no revalidation
      expect(revalidate.addRevalidationJob).not.toHaveBeenCalled();

      await service.createAdditionalProduct(
        { additional_product_group_id: g.id, price: 3, translations: TR },
        ORG,
        'mine',
      );
      // ...and is invisible to the other tenant
      await expect(
        service.deleteGroup(g.id, t.theirs.org.id, 'theirs'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates and deletes my own group', async () => {
      await service.updateGroup(
        t.mine.group.id,
        {
          is_required: true,
          translations: [
            { id: t.mine.groupTr.id, lang: 'ru', title: 'Новые соусы' },
          ],
        },
        ORG,
        'mine',
      );
      expect(
        db.data.additional_product_group.find((r) => r.id === t.mine.group.id)
          ?.is_required,
      ).toBe(true);
      await service.deleteGroup(t.mine.group.id, ORG, 'mine');
      expect(
        db.data.additional_product_group.some((r) => r.id === t.mine.group.id),
      ).toBe(false);
    });
  });

  describe('options', () => {
    it('refuses to add an option to someone else’s group', async () => {
      await refused(
        service.createAdditionalProduct(
          {
            additional_product_group_id: t.theirs.group.id,
            price: 1,
            translations: TR,
          },
          ORG,
          'mine',
        ),
      );
    });

    it('refuses to update or delete someone else’s option', async () => {
      await refused(
        service.updateAdditionalProduct(
          t.theirs.option.id,
          { price: 0 },
          ORG,
          'mine',
        ),
      );
      await refused(service.delete(t.theirs.option.id, ORG, 'mine'));
      expect(
        db.data.additional_product.find((r) => r.id === t.theirs.option.id)
          ?.price,
      ).toBe(5);
    });

    it('refuses to move my option into someone else’s group', async () => {
      await refused(
        service.updateAdditionalProduct(
          t.mine.option.id,
          { additional_product_group_id: t.theirs.group.id },
          ORG,
          'mine',
        ),
      );
    });

    it('refuses translation ids of another option', async () => {
      await refused(
        service.updateAdditionalProduct(
          t.mine.option.id,
          {
            translations: [
              { id: t.theirs.optionTr.id, lang: 'ru', title: 'hijack' },
            ],
          },
          ORG,
          'mine',
        ),
      );
    });

    it('creates, updates and deletes my own option', async () => {
      const created = await service.createAdditionalProduct(
        {
          additional_product_group_id: t.mine.group.id,
          price: 7,
          translations: TR,
        },
        ORG,
        'mine',
      );
      await service.updateAdditionalProduct(
        created.id,
        { price: 8 },
        ORG,
        'mine',
      );
      expect(
        db.data.additional_product.find((r) => r.id === created.id)?.price,
      ).toBe(8);
      await service.delete(created.id, ORG, 'mine');
      expect(db.data.additional_product.some((r) => r.id === created.id)).toBe(
        false,
      );
    });
  });
});
