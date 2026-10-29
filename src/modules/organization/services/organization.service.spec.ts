import {
  PLATFORM_ORDER_SETTINGS,
  PLATFORM_SETTINGS,
} from '../domain/platform-defaults';
import { OrganizationService } from './organization.service';

describe('OrganizationService.create', () => {
  function setup(existing: Record<string, unknown> | null) {
    const db = {
      organization: {
        findUnique: jest.fn(async () => existing),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }) => ({ id: 'org-new', ...data })),
        update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
      },
    };
    const service = new OrganizationService(db as any, {} as any, {} as any, {} as any);
    return { db, service };
  }

  it('creates both settings rows with the platform defaults in the same write', async () => {
    const { db, service } = setup(null);
    await service.create({ name: 'Demo Cafe', type: 'cafe' } as any, 'user-1');

    const { data } = db.organization.create.mock.calls[0][0];
    expect(data.settings).toEqual({ create: PLATFORM_SETTINGS });
    expect(data.order_settings).toEqual({ create: PLATFORM_ORDER_SETTINGS });
    expect(PLATFORM_SETTINGS).toEqual({
      currency: 'UZS',
      default_language: 'ru',
      languages: ['ru', 'uz', 'en'],
    });
  });

  it('adds missing settings rows to a venue left by the old signup flow without touching existing ones', async () => {
    const { db, service } = setup({ id: 'org-old', owner_id: 'user-1' });
    await service.create({ name: 'Demo Cafe', type: 'cafe' } as any, 'user-1');

    expect(db.organization.create).not.toHaveBeenCalled();
    const { data } = db.organization.update.mock.calls[0][0];
    expect(data.settings).toEqual({
      upsert: { create: PLATFORM_SETTINGS, update: {} },
    });
    expect(data.order_settings).toEqual({
      upsert: { create: PLATFORM_ORDER_SETTINGS, update: {} },
    });
  });
});
