import { CustomerAuthException } from '../auth/errors/customer-auth.exception';
import { TenantService } from './tenant.service';

const ID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const OFF = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const BARE = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';
const SETTINGS = {
  default_language: 'uz',
  languages: ['uz', 'ru'],
  currency: 'UZS',
};

describe('TenantService.resolve', () => {
  let orgs: Record<string, any>[];
  let findUnique: jest.Mock;
  let service: TenantService;

  beforeEach(() => {
    orgs = [
      {
        id: ID,
        slug: 'mant',
        name: 'Mant',
        is_active: true,
        settings: SETTINGS,
      },
      {
        id: OFF,
        slug: 'off',
        name: 'Off',
        is_active: false,
        settings: SETTINGS,
      },
      { id: BARE, slug: 'bare', name: 'Bare', is_active: true, settings: null },
    ];
    findUnique = jest.fn(async ({ where }) => {
      const org = orgs.find((o) => o.id === where.id);
      return org ? { ...org } : null;
    });
    service = new TenantService({ organization: { findUnique } } as any);
  });

  const code = (p: Promise<unknown>) =>
    p.then(
      () => 'resolved',
      (e) => (e instanceof CustomerAuthException ? e.code : e),
    );

  it('resolves an organization by id with its language and currency settings', async () => {
    await expect(service.resolve(ID)).resolves.toEqual({
      id: ID,
      slug: 'mant',
      brandName: 'Mant',
      defaultLanguage: 'uz',
      languages: ['uz', 'ru'],
      currency: 'UZS',
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID } }),
    );
  });

  it('accepts the id in upper case', async () => {
    await expect(service.resolve(ID.toUpperCase())).resolves.toMatchObject({
      id: ID,
    });
  });

  it('does not accept a slug, and does not even look it up', async () => {
    expect(await code(service.resolve('mant'))).toBe('tenant_not_found');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('404s an unknown id and 403s an inactive tenant', async () => {
    expect(
      await code(service.resolve('11111111-2222-4333-8444-555555555555')),
    ).toBe('tenant_not_found');
    expect(await code(service.resolve(OFF))).toBe('tenant_inactive');
  });

  it('refuses a venue without its settings row instead of inventing defaults', async () => {
    expect(await code(service.resolve(BARE))).toBe('settings_missing');
  });

  it('drops unknown language codes stored in the settings', async () => {
    orgs[0].settings = { ...SETTINGS, languages: ['uz', 'kk', 'ru'] };
    await expect(service.resolve(ID)).resolves.toMatchObject({
      languages: ['uz', 'ru'],
    });
  });

  it('caches by id until invalidated', async () => {
    await service.resolve(ID);
    orgs[0].name = 'Renamed';
    await expect(service.resolve(ID)).resolves.toMatchObject({
      brandName: 'Mant',
    });
    expect(findUnique).toHaveBeenCalledTimes(1);

    service.invalidate(ID);
    await expect(service.resolve(ID)).resolves.toMatchObject({
      brandName: 'Renamed',
    });
  });
});
