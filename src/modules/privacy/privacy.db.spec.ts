import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { CustomerAnonymizerService } from 'src/modules/customer/services/customer-anonymizer.service';
import { PrivacyRetentionService } from './privacy-retention.service';

/**
 * Anonymization and retention on a real PostgreSQL (the Prisma filters on the JSON column and the
 * partial unique index are what mocks cannot show). Runs where DATABASE_URL points at an xmenu_* database.
 */
// These tests write rows, so they run only on a throwaway database named xmenu_* (CI: xmenu_ci), never on a dev
// database that happens to be in .env
const url = /\/xmenu_[^/?]*(\?.*)?$/.test(process.env.DATABASE_URL ?? '')
  ? process.env.DATABASE_URL
  : undefined;
const describeDb = url ? describe : describe.skip;

describeDb('guest anonymization and retention (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let anonymizer: CustomerAnonymizerService;
  let retention: PrivacyRetentionService;
  const orgs: string[] = [];

  beforeAll(() => {
    prisma = new PrismaClient({ datasourceUrl: url });
    anonymizer = new CustomerAnonymizerService(prisma as never);
    retention = new PrivacyRetentionService(prisma as never);
  });
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
    await prisma.$disconnect();
  });

  async function venue() {
    const org = await prisma.organization.create({
      data: { name: `priv-${randomUUID().slice(0, 8)}` },
    });
    orgs.push(org.id);
    const branch = await prisma.branch.create({
      data: {
        organization_id: org.id,
        title: 'B',
        address: 'A',
        latitude: 41.3,
        longitude: 69.2,
      },
    });
    return { orgId: org.id, branchId: branch.id };
  }

  let seq = 0;
  async function order(
    v: { orgId: string; branchId: string },
    customerId: string,
    over: {
      status?: 'completed' | 'pending_acceptance';
      createdAt?: Date;
    } = {},
  ) {
    return prisma.customer_order.create({
      data: {
        number: ++seq,
        organization_id: v.orgId,
        customer_id: customerId,
        branch_id: v.branchId,
        status: over.status ?? 'completed',
        fulfillment: 'delivery',
        idempotency_key: randomUUID(),
        request_hash: 'h',
        phone: '+998900000001',
        comment: 'ring twice',
        address_snapshot: { address: 'Street 1', latitude: 41.3 },
        guest_telegram_id: '777',
        guest_telegram_bot_id: '888',
        payment_method: 'cash',
        payment_status: 'not_required',
        currency: 'UZS',
        subtotal: 5000,
        total: 5000,
        created_at: over.createdAt,
      },
    });
  }

  it('deletes the guest: personal data gone, sums and dates stay, the same phone can sign up again', async () => {
    const v = await venue();
    const phone = `+99890${Math.floor(1000000 + Math.random() * 8999999)}`;
    const guest = await prisma.customer.create({
      data: {
        organization_id: v.orgId,
        phone,
        name: 'Ali',
        telegram_id: '777',
      },
    });
    await prisma.customer_address.create({
      data: { customer_id: guest.id, address: 'Street 1' },
    });
    const done = await order(v, guest.id);

    const dry = await anonymizer.deleteGuest(v.orgId, guest.id, {
      dryRun: true,
    });
    expect(dry).toMatchObject({ addresses: 1, orders: 1 });
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: guest.id } }))
        .phone,
    ).toBe(phone);

    const r = await anonymizer.deleteGuest(v.orgId, guest.id);
    expect(r).toMatchObject({ dryRun: false, addresses: 1, orders: 1 });

    const row = await prisma.customer.findUniqueOrThrow({
      where: { id: guest.id },
    });
    expect(row).toMatchObject({ phone: null, name: null, telegram_id: null });
    expect(row.deleted_at).toBeInstanceOf(Date);
    expect(
      await prisma.customer_address.count({ where: { customer_id: guest.id } }),
    ).toBe(0);

    const o = await prisma.customer_order.findUniqueOrThrow({
      where: { id: done.id },
    });
    expect(o).toMatchObject({
      phone: null,
      comment: null,
      address_snapshot: null,
      guest_telegram_id: null,
      guest_telegram_bot_id: null,
      total: 5000,
      status: 'completed',
    });

    // Idempotent: nothing left to change
    expect(
      await anonymizer.deleteGuest(v.orgId, guest.id).catch(() => 'gone'),
    ).toBe('gone');
    expect(await anonymizer.findGuestId(v.orgId, phone)).toBeNull();

    // The same phone signs up as a new guest (partial unique index ignores the deleted row)
    const again = await prisma.customer.create({
      data: { organization_id: v.orgId, phone, name: 'Ali' },
    });
    expect(again.id).not.toBe(guest.id);
  });

  it('refuses while an order is unfinished and changes nothing', async () => {
    const v = await venue();
    const guest = await prisma.customer.create({
      data: { organization_id: v.orgId, phone: '+998901111111', name: 'Bek' },
    });
    await order(v, guest.id, { status: 'pending_acceptance' });
    await expect(
      anonymizer.deleteGuest(v.orgId, guest.id),
    ).rejects.toMatchObject({ code: 'has_active_orders' });
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: guest.id } }))
        .phone,
    ).toBe('+998901111111');
  });

  it('retention anonymizes only finished orders older than the period, and a second run finds nothing', async () => {
    const v = await venue();
    const guest = await prisma.customer.create({
      data: { organization_id: v.orgId, phone: '+998902222222', name: 'Dil' },
    });
    const now = new Date();
    const day = 24 * 60 * 60 * 1000;
    const old = await order(v, guest.id, {
      createdAt: new Date(now.getTime() - 40 * day),
    });
    const fresh = await order(v, guest.id, {
      createdAt: new Date(now.getTime() - 5 * day),
    });
    const oldOpen = await order(v, guest.id, {
      status: 'pending_acceptance',
      createdAt: new Date(now.getTime() - 40 * day),
    });

    const env = { ORDER_PII_RETENTION_DAYS: '30' };
    const first = await retention.run(now, env);
    expect(first.orders).toBeGreaterThanOrEqual(1);
    const phoneOf = async (id: string) =>
      (await prisma.customer_order.findUniqueOrThrow({ where: { id } })).phone;
    expect(await phoneOf(old.id)).toBeNull();
    expect(await phoneOf(fresh.id)).not.toBeNull();
    expect(await phoneOf(oldOpen.id)).not.toBeNull();

    const second = await retention.run(now, env);
    expect(second.orders).toBe(0);
    // The guest row itself is not touched by order retention
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: guest.id } }))
        .phone,
    ).toBe('+998902222222');
  });

  it('retention deletes old audit rows, expired sessions and old applications', async () => {
    const now = new Date();
    const day = 24 * 60 * 60 * 1000;
    const marker = randomUUID();
    const ev = await prisma.staff_auth_event.createMany({
      data: [
        { type: marker, created_at: new Date(now.getTime() - 91 * day) },
        { type: marker, created_at: new Date(now.getTime() - 89 * day) },
      ],
    });
    expect(ev.count).toBe(2);
    await prisma.application.createMany({
      data: [
        {
          from: 'web',
          description: marker,
          created_at: new Date(now.getTime() - 366 * day),
        },
        {
          from: 'web',
          description: marker,
          created_at: new Date(now.getTime() - 10 * day),
        },
      ],
    });

    await retention.run(now, {});

    expect(
      await prisma.staff_auth_event.count({ where: { type: marker } }),
    ).toBe(1);
    expect(
      await prisma.application.count({ where: { description: marker } }),
    ).toBe(1);
    await prisma.staff_auth_event.deleteMany({ where: { type: marker } });
    await prisma.application.deleteMany({ where: { description: marker } });
  });
});
