import { NotFoundException } from '@nestjs/common';
import { BranchService, toBranchView } from './branch.service';

describe('BranchService: delivery site revalidation', () => {
  const ORG = 'org-1';
  const make = (owned = true) => {
    const prisma = {
      branch: {
        create: jest.fn(async ({ data }) => ({ id: 'b-1', ...data })),
        update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
        delete: jest.fn(async () => ({})),
        findFirst: jest.fn(async () => (owned ? { id: 'b-1' } : null)),
      },
      customer_order: { count: jest.fn(async () => 0) },
    };
    const revalidate = { addRevalidationJob: jest.fn() };
    return {
      service: new BranchService(prisma as any, revalidate as any),
      revalidate,
    };
  };

  it('schedules the branches route after create, update and remove', async () => {
    const { service, revalidate } = make();
    await service.create(ORG, { title: 'A' } as any);
    await service.update(ORG, 'b-1', { title: 'B' } as any);
    await expect(service.remove(ORG, 'b-1')).resolves.toEqual({
      deleted: true,
    });
    expect(revalidate.addRevalidationJob).toHaveBeenCalledTimes(3);
    expect(revalidate.addRevalidationJob).toHaveBeenCalledWith({
      tenantId: ORG,
      route: 'branches',
    });
  });

  it('schedules nothing for a branch of another venue', async () => {
    const { service, revalidate } = make(false);
    await expect(service.update(ORG, 'b-2', {} as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(revalidate.addRevalidationJob).not.toHaveBeenCalled();
  });
});

describe('toBranchView: status', () => {
  const row = (days: object[]) =>
    ({
      id: 'b-1',
      title: 'A',
      address: 'Street 1',
      latitude: 41.3,
      longitude: 69.2,
      phone: null,
      timezone: 'Asia/Tashkent',
      working_hours: days,
      hours_exceptions: [],
    }) as any;
  const now = new Date('2026-10-12T07:00:00Z'); // Monday 12:00 in Tashkent
  const open = {
    weekday: 1,
    opens_at: '09:00',
    closes_at: '23:00',
    is_24h: false,
    is_closed: false,
  };

  it('no hours: no_schedule with an empty hours string', () => {
    expect(toBranchView(row([]), 'ru', now)).toMatchObject({
      status: 'no_schedule',
      hours: '',
      isOpen: false,
      opensAt: null,
    });
  });

  it('every day off: closed_all_days, hours is empty too', () => {
    const off = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      ...open,
      weekday,
      is_closed: true,
    }));
    expect(toBranchView(row(off), 'ru', now)).toMatchObject({
      status: 'closed_all_days',
      hours: '',
      isOpen: false,
      opensAt: null,
    });
  });

  it('open today: open', () => {
    const days = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ ...open, weekday }));
    expect(toBranchView(row(days), 'ru', now)).toMatchObject({
      status: 'open',
      isOpen: true,
    });
  });
});
