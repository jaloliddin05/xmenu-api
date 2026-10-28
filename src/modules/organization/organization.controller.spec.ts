import { NotFoundException } from '@nestjs/common';
import {
  FakeMenuPrisma,
  seedTwoTenants,
} from 'src/modules/_prisma/menu-prisma.fake';
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
    db.seed('organization_translation', {
      organization_id: t.mine.org.id,
      lang: 'ru',
      description: 'мы',
    });
    theirTr = db.seed('organization_translation', {
      organization_id: t.theirs.org.id,
      lang: 'ru',
      description: 'они',
    });
    files = {
      updateFile: jest.fn(async () => ({ id: 'file-new' })),
      removeFile: jest.fn(),
    };
    revalidate = { addRevalidationJob: jest.fn() };
    controller = new OrganizationController(
      new OrganizationService(db as any, files as any, revalidate as any),
    );
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
    await expect(controller.findOne(t.mine.org.id, req)).resolves.toMatchObject(
      { id: t.mine.org.id },
    );
    await refused(controller.findOne(t.theirs.org.id, req));
  });

  it('refuses to update their organization, including its logo', async () => {
    await refused(
      controller.update(
        t.theirs.org.id,
        { name: 'pwned' } as any,
        { logo: [{} as any] },
        req,
      ),
    );
    expect(
      db.data.organization.find((o) => o.id === t.theirs.org.id)?.name,
    ).toBe('Theirs');
  });

  it('refuses their translation ids in my update', async () => {
    await refused(
      controller.update(
        t.mine.org.id,
        {
          translations: [{ id: theirTr.id, lang: 'ru', description: 'hijack' }],
        } as any,
        {},
        req,
      ),
    );
  });

  it('refuses to delete their organization', async () => {
    await refused(controller.remove(t.theirs.org.id, req));
    expect(db.data.organization.some((o) => o.id === t.theirs.org.id)).toBe(
      true,
    );
  });

  it('still updates my own organization', async () => {
    await controller.update(t.mine.org.id, { name: 'Mine 2' } as any, {}, req);
    expect(db.data.organization.find((o) => o.id === t.mine.org.id)?.name).toBe(
      'Mine 2',
    );
  });
});

describe('Organization slug', () => {
  let db: FakeMenuPrisma;
  let t: ReturnType<typeof seedTwoTenants>;
  let controller: OrganizationController;
  let req: { user: { organization: { id: string; slug: string } } };

  beforeEach(() => {
    db = new FakeMenuPrisma();
    t = seedTwoTenants(db);
    controller = new OrganizationController(
      new OrganizationService(
        db as any,
        { updateFile: jest.fn(), removeFile: jest.fn() } as any,
        { addRevalidationJob: jest.fn() } as any,
      ),
    );
    req = { user: { organization: { id: t.mine.org.id, slug: 'mine' } } };
  });

  const slugOf = (id: string) =>
    db.data.organization.find((o) => o.id === id)?.slug;

  it('409s a slug another venue already has, and changes nothing', async () => {
    await expect(
      controller.update(t.mine.org.id, { slug: 'theirs' } as any, {}, req),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'slug_taken' },
    });
    expect(slugOf(t.mine.org.id)).toBe('mine');
    expect(db.log).toEqual([]);
  });

  it('accepts my current slug and a free one', async () => {
    await controller.update(t.mine.org.id, { slug: 'mine' } as any, {}, req);
    await controller.update(t.mine.org.id, { slug: 'mine-2' } as any, {}, req);
    expect(slugOf(t.mine.org.id)).toBe('mine-2');
  });

  it('turns a unique-index race into 409', async () => {
    const { Prisma } = jest.requireActual('@prisma/client');
    jest.spyOn((db as any).organization, 'update').mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      controller.update(t.mine.org.id, { slug: 'fresh' } as any, {}, req),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('check-slug: 400 on an invalid slug, otherwise whether it is taken', async () => {
    for (const slug of ['a/b', '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e', 'ab']) {
      await expect(controller.checkSlug(slug)).rejects.toMatchObject({
        status: 400,
        response: { code: 'invalid_slug' },
      });
    }
    await expect(controller.checkSlug('theirs')).resolves.toEqual({
      exists: true,
    });
    await expect(controller.checkSlug('free-one')).resolves.toEqual({
      exists: false,
    });
  });
});
