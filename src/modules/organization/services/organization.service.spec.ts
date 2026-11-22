import {
  PLATFORM_ORDER_SETTINGS,
  PLATFORM_SETTINGS,
} from '../domain/platform-defaults';
import { OrganizationService } from './organization.service';

const OWNER = {
  id: 'user-1',
  phone: '+998901234567',
  first_name: 'Ali',
  last_name: null,
};

describe('OrganizationService.create', () => {
  function setup(existing: Record<string, unknown> | null) {
    const db = {
      organization_member: {
        findUnique: jest.fn(async () =>
          existing ? { organization: existing } : null,
        ),
      },
      organization: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }) => ({ id: 'org-new', ...data })),
        update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
      },
    };
    const service = new OrganizationService(
      db as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { db, service };
  }

  it('creates both settings rows with the platform defaults in the same write', async () => {
    const { db, service } = setup(null);
    await service.create({ name: 'Demo Cafe', type: 'cafe' } as any, OWNER);

    const { data } = db.organization.create.mock.calls[0][0];
    expect(data.members).toEqual({
      create: expect.objectContaining({
        user_id: 'user-1',
        role: 'owner',
        status: 'active',
        phone: '+998901234567',
        first_name: 'Ali',
      }),
    });
    expect(data.settings).toEqual({ create: PLATFORM_SETTINGS });
    expect(data.order_settings).toEqual({ create: PLATFORM_ORDER_SETTINGS });
    expect(PLATFORM_SETTINGS).toEqual({
      currency: 'UZS',
      default_language: 'ru',
      languages: ['ru', 'uz', 'en'],
    });
  });

  it('adds missing settings rows to a venue left by the old signup flow without touching existing ones', async () => {
    const { db, service } = setup({ id: 'org-old' });
    await service.create({ name: 'Demo Cafe', type: 'cafe' } as any, OWNER);

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

describe('OrganizationService.delete', () => {
  function setup(activeOrders: number, integration: { id: string } | null) {
    const tx = {
      $queryRaw: jest.fn(async () => [{ id: 'org-1' }]),
      customer_order: { count: jest.fn(async () => activeOrders) },
      organization: { delete: jest.fn(async () => ({ id: 'org-1' })) },
    };
    const db = {
      pos_integration: { findUnique: jest.fn(async () => integration) },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const tenants = { invalidate: jest.fn() };
    const posSync = { unschedule: jest.fn(async () => undefined) };
    const service = new OrganizationService(
      db as any,
      {} as any,
      {} as any,
      tenants as any,
      {} as any,
      posSync as any,
    );
    return { tx, tenants, posSync, service };
  }

  it('refuses with has_active_orders while an order is unfinished and keeps the iiko schedule', async () => {
    const { tx, tenants, posSync, service } = setup(2, { id: 'pos-1' });

    await expect(service.delete('org-1', 'org-1')).rejects.toMatchObject({
      code: 'has_active_orders',
      details: { activeOrders: 2 },
    });
    expect(tx.customer_order.count.mock.calls[0][0]).toEqual({
      where: {
        organization_id: 'org-1',
        status: {
          in: expect.arrayContaining([
            'awaiting_payment',
            'payment_failed',
            'pending_acceptance',
            'accepted',
          ]),
        },
      },
    });
    expect(tx.organization.delete).not.toHaveBeenCalled();
    expect(tenants.invalidate).not.toHaveBeenCalled();
    expect(posSync.unschedule).not.toHaveBeenCalled();
  });

  it('deletes after locking the row and then removes the iiko schedulers of the venue', async () => {
    const { tx, tenants, posSync, service } = setup(0, { id: 'pos-1' });

    await service.delete('org-1', 'org-1');

    expect(String(tx.$queryRaw.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(tx.organization.delete).toHaveBeenCalledWith({
      where: { id: 'org-1' },
    });
    expect(tenants.invalidate).toHaveBeenCalledWith('org-1');
    expect(posSync.unschedule).toHaveBeenCalledWith('pos-1');
  });

  it('a venue without iiko has nothing to unschedule', async () => {
    const { posSync, service } = setup(0, null);
    await service.delete('org-1', 'org-1');
    expect(posSync.unschedule).not.toHaveBeenCalled();
  });
});
