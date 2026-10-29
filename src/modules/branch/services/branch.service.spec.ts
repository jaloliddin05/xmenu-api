import { NotFoundException } from '@nestjs/common';
import { BranchService } from './branch.service';

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
    return { service: new BranchService(prisma as any, revalidate as any), revalidate };
  };

  it('schedules the branches route after create, update and remove', async () => {
    const { service, revalidate } = make();
    await service.create(ORG, { title: 'A' } as any);
    await service.update(ORG, 'b-1', { title: 'B' } as any);
    await expect(service.remove(ORG, 'b-1')).resolves.toEqual({ deleted: true });
    expect(revalidate.addRevalidationJob).toHaveBeenCalledTimes(3);
    expect(revalidate.addRevalidationJob).toHaveBeenCalledWith({ tenantId: ORG, route: 'branches' });
  });

  it('schedules nothing for a branch of another venue', async () => {
    const { service, revalidate } = make(false);
    await expect(service.update(ORG, 'b-2', {} as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(revalidate.addRevalidationJob).not.toHaveBeenCalled();
  });
});
