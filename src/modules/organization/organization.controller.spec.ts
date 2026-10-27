import { NotFoundException } from '@nestjs/common';
import { FakeMenuPrisma, seedTwoTenants } from 'src/modules/_prisma/menu-prisma.fake';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './services/organization.service';

describe('Organization endpoints: own organization only (IDOR)', () => {
  let db: FakeMenuPrisma;
  let t: ReturnType<typeof seedTwoTenants>;
  let files: { updateFile: jest.Mock; removeFile: jest.Mock };
  let revalidate: { addRevalidationJob: jest.Mock };
  let controller: OrganizationController;
  let req: { user: { organization: { id: string; slug: string } } };
  let theirTr: { id: string };

  beforeEach(() => {
    db = new FakeMenuPrisma();
    t = seedTwoTenants(db);
    db.seed('organization_translation', { organization_id: t.mine.org.id, lang: 'ru', description: 'мы' });
    theirTr = db.seed('organization_translation', { organization_id: t.theirs.org.id, lang: 'ru', description: 'они' });
    files = { updateFile: jest.fn(async () => ({ id: 'file-new' })), removeFile: jest.fn() };
    revalidate = { addRevalidationJob: jest.fn() };
    controller = new OrganizationController(new OrganizationService(db as any, files as any, revalidate as any));
    req = { user: { organization: { id: t.mine.org.id, slug: 'mine' } } };
  });

  async function refused(p: Promise<unknown>) {
    await expect(p).rejects.toBeInstanceOf(NotFoundException);
    expect(db.log).toEqual([]);
    expect(files.updateFile).not.toHaveBeenCalled();
    expect(revalidate.addRevalidationJob).not.toHaveBeenCalled();
  }

  it('no longer lists every organization', () => {
    expect((controller as any).findAll).toBeUndefined();
  });

  it('reads mine and 404s on theirs', async () => {
    await expect(controller.findOne(t.mine.org.id, req)).resolves.toMatchObject({ id: t.mine.org.id });
    await refused(controller.findOne(t.theirs.org.id, req));
  });

  it('refuses to update their organization, including its logo', async () => {
    await refused(
      controller.update(t.theirs.org.id, { name: 'pwned' } as any, { logo: [{} as any] }, req),
    );
    expect(db.data.organization.find((o) => o.id === t.theirs.org.id)?.name).toBe('Theirs');
  });

  it('refuses their translation ids in my update', async () => {
    await refused(
      controller.update(
        t.mine.org.id,
        { translations: [{ id: theirTr.id, lang: 'ru', description: 'hijack' }] } as any,
        {},
        req,
      ),
    );
  });

  it('refuses to delete their organization', async () => {
    await refused(controller.remove(t.theirs.org.id, req));
    expect(db.data.organization.some((o) => o.id === t.theirs.org.id)).toBe(true);
  });

  it('still updates my own organization', async () => {
    await controller.update(t.mine.org.id, { name: 'Mine 2' } as any, {}, req);
    expect(db.data.organization.find((o) => o.id === t.mine.org.id)?.name).toBe('Mine 2');
  });
});
