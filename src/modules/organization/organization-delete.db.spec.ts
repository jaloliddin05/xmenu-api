import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

/**
 * DELETE /organization/:id removes the organization row with one statement; everything else goes by foreign keys.
 * This pins what that does on a real PostgreSQL when the venue already has guests, orders and couriers
 * (the RESTRICT keys customer_order -> customer and -> branch are the interesting part). Runs where DATABASE_URL points at an xmenu_* database.
 */
// These tests write rows, so they run only on a throwaway database named xmenu_* (CI: xmenu_ci), never on a dev
// database that happens to be in .env
const url = /\/xmenu_[^/?]*(\?.*)?$/.test(process.env.DATABASE_URL ?? '')
  ? process.env.DATABASE_URL
  : undefined;
const describeDb = url ? describe : describe.skip;

describeDb(
  'organization delete with guests, orders and couriers (PostgreSQL)',
  () => {
    let prisma: PrismaClient;

    beforeAll(() => {
      prisma = new PrismaClient({ datasourceUrl: url });
    });
    afterAll(async () => {
      await prisma.$disconnect();
    });

    async function seed(withOrder: boolean) {
      const org = await prisma.organization.create({
        data: { name: `del-${randomUUID().slice(0, 8)}` },
      });
      const branch = await prisma.branch.create({
        data: {
          organization_id: org.id,
          title: 'B',
          address: 'A',
          latitude: 41.3,
          longitude: 69.2,
        },
      });
      const customer = await prisma.customer.create({
        data: { organization_id: org.id, phone: '+998900000001', name: 'G' },
      });
      const courier = await prisma.courier.create({
        data: { organization_id: org.id, name: 'C', phone: '+998900000002' },
      });
      if (withOrder)
        await prisma.customer_order.create({
          data: {
            number: 1,
            organization_id: org.id,
            customer_id: customer.id,
            branch_id: branch.id,
            courier_id: courier.id,
            status: 'completed',
            fulfillment: 'pickup',
            idempotency_key: randomUUID(),
            request_hash: 'h',
            phone: '+998900000001',
            payment_method: 'cash',
            payment_status: 'not_required',
            currency: 'UZS',
            subtotal: 1000,
            total: 1000,
          },
        });
      return org.id;
    }

    const counts = async (orgId: string) => ({
      org: await prisma.organization.count({ where: { id: orgId } }),
      customers: await prisma.customer.count({
        where: { organization_id: orgId },
      }),
      orders: await prisma.customer_order.count({
        where: { organization_id: orgId },
      }),
      branches: await prisma.branch.count({
        where: { organization_id: orgId },
      }),
      couriers: await prisma.courier.count({
        where: { organization_id: orgId },
      }),
    });

    it('a venue without orders is deleted with its guests, branches and couriers', async () => {
      const id = await seed(false);
      await prisma.organization.delete({ where: { id } });
      expect(await counts(id)).toEqual({
        org: 0,
        customers: 0,
        orders: 0,
        branches: 0,
        couriers: 0,
      });
    });

    it('a venue with an order is deleted too: the cascade from the organization removes the order before the RESTRICT keys object', async () => {
      const id = await seed(true);
      expect(await counts(id)).toMatchObject({ orders: 1, customers: 1 });
      await prisma.organization.delete({ where: { id } });
      expect(await counts(id)).toEqual({
        org: 0,
        customers: 0,
        orders: 0,
        branches: 0,
        couriers: 0,
      });
    });
  },
);
