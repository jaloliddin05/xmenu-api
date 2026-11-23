import { Prisma } from '@prisma/client';
import { RegionCatalog } from '../regions/region-catalog';
import { DeliveryAreaService } from './delivery-area.service';

const ORG = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const RING = [
  [41, 69],
  [41, 70],
  [42, 70],
];

describe('DeliveryAreaService reads', () => {
  const setup = () => {
    const tx = {
      delivery_area: {
        findUnique: jest.fn(async () => ({
          organization_id: ORG,
          base_price: 1000,
          included_km: 1,
          price_per_km: 100,
          min_order: 0,
          free_from: null,
        })),
      },
      delivery_area_part: {
        findMany: jest.fn(async () => [
          { source: 'custom', region_code: null, geometry: [RING] },
        ]),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
      delivery_area: { findUnique: jest.fn() },
      delivery_area_part: { findMany: jest.fn() },
    };
    const service = new DeliveryAreaService(
      prisma as never,
      new RegionCatalog(),
    );
    return { prisma, tx, service };
  };

  it.each(['forPricing', 'forGuest'] as const)(
    '%s reads the area and its parts in one RepeatableRead snapshot',
    async (method) => {
      const { prisma, tx, service } = setup();
      const result = await service[method](ORG);
      expect(result).not.toBeNull();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
      expect(tx.delivery_area.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.delivery_area_part.findMany).toHaveBeenCalledTimes(1);
      // nothing is read outside the snapshot
      expect(prisma.delivery_area.findUnique).not.toHaveBeenCalled();
      expect(prisma.delivery_area_part.findMany).not.toHaveBeenCalled();
    },
  );
});
