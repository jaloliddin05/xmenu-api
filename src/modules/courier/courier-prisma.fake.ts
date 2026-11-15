import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

/**
 * In-memory stand-in for the Prisma tables the courier services and OrderTransitionService use: couriers,
 * invitations, shifts, cards, orders and the order journal. `where` supports equality, null, `in`, `gt`
 * and `NOT`; `select` and most `include` return the whole row (the services read what they need).
 */
type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (key === 'NOT') {
      if (matches(row, cond)) return false;
      continue;
    }
    const value = row[key];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond && !cond.in.includes(value)) return false;
      if ('gt' in cond && !(value > cond.gt)) return false;
      continue;
    }
    if (cond === null ? value != null : value !== cond) return false;
  }
  return true;
}

function apply(row: Row, data: Row) {
  for (const [key, v] of Object.entries(data)) {
    if (v === undefined) continue;
    row[key] =
      v && typeof v === 'object' && 'increment' in v
        ? row[key] + v.increment
        : v;
  }
  if ('updated_at' in row) row.updated_at = new Date();
}

const uniqueError = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'fake',
  });

class Table {
  rows: Row[] = [];
  constructor(
    private readonly defaults: () => Row = () => ({}),
    private readonly unique: (rows: Row[], row: Row) => boolean = () => false,
  ) {}

  private sorted(args: Row = {}) {
    let out = this.rows.filter((r) => matches(r, args.where));
    const order = Array.isArray(args.orderBy) ? args.orderBy[0] : args.orderBy;
    if (order) {
      const [k, dir] = Object.entries(order)[0] as [string, string];
      out = [...out].sort(
        (a, b) =>
          (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (dir === 'desc' ? -1 : 1),
      );
    }
    return args.take ? out.slice(0, args.take) : out;
  }
  findMany = async (args: Row = {}) => this.sorted(args).map((r) => ({ ...r }));
  findFirst = async (args: Row = {}) => {
    const r = this.sorted(args)[0];
    return r ? { ...r } : null;
  };
  findUnique = async (args: Row) => {
    const where = { ...args.where };
    for (const [k, v] of Object.entries(where))
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        delete where[k];
        Object.assign(where, v);
      }
    return this.findFirst({ where });
  };
  findUniqueOrThrow = async (args: Row) => {
    const r = await this.findUnique(args);
    if (!r) throw new Error('not found');
    return r;
  };
  count = async (args: Row = {}) => this.sorted(args).length;
  create = async (args: Row) => {
    const row = {
      id: randomUUID(),
      created_at: new Date(),
      ...this.defaults(),
      ...args.data,
    };
    if (this.unique(this.rows, row)) throw uniqueError();
    this.rows.push(row);
    return { ...row };
  };
  update = async (args: Row) => {
    const row = this.rows.find((r) => matches(r, args.where));
    if (!row) throw new Error('not found');
    apply(row, args.data);
    return { ...row };
  };
  updateMany = async (args: Row) => {
    const rows = this.rows.filter((r) => matches(r, args.where));
    rows.forEach((r) => apply(r, args.data));
    return { count: rows.length };
  };
  upsert = async (args: Row) => {
    const existing = await this.findUnique({ where: args.where });
    if (existing)
      return this.update({ where: { id: existing.id }, data: args.update });
    return this.create({ data: args.create });
  };
  get(id: string) {
    return this.rows.find((r) => r.id === id)!;
  }
}

export const FAKE_BRANCH_ID = '44444444-4444-4444-8444-444444444444';

export function makeCourierDb() {
  const organization = new Table();
  const courier = new Table(
    () => ({
      is_active: true,
      telegram_user_id: null,
      telegram_chat_id: null,
      language_code: null,
      linked_at: null,
      disabled_at: null,
      updated_at: new Date(),
    }),
    (rows, row) =>
      rows.some(
        (r) =>
          r.organization_id === row.organization_id &&
          (r.phone === row.phone ||
            (row.telegram_user_id &&
              r.telegram_user_id === row.telegram_user_id)),
      ),
  );
  const courier_invitation = new Table(() => ({
    used_at: null,
    revoked_at: null,
  }));
  // courier_shift_one_open_per_courier
  const courier_shift = new Table(
    () => ({
      status: 'open',
      started_at: new Date(),
      ended_at: null,
      ended_by: null,
      ended_by_user_id: null,
    }),
    (rows, row) =>
      rows.some((r) => r.courier_id === row.courier_id && r.status === 'open'),
  );
  const courier_card = new Table(() => ({ updated_at: new Date() }));
  const customer_order = new Table(() => ({
    version: 0,
    courier_id: null,
    courier_assigned_at: null,
    courier_shift_id: null,
    door_problem: null,
    door_problem_reason: null,
    payment_status: 'not_required',
    payment_method: 'cash',
    fulfillment: 'delivery',
  }));
  let eventId = 0;
  const order_status_event = new Table(() => ({ id: ++eventId }));

  const db = {
    organization,
    courier,
    courier_invitation,
    courier_shift,
    courier_card,
    customer_order,
    order_status_event,
    $transaction: async (arg: any) =>
      typeof arg === 'function' ? arg(db) : Promise.all(arg),
  };

  // include: shifts (open) and _count.orders on a courier; courier + organization on an invitation
  const withInclude = async (c: Row | null, include: Row | undefined) => {
    if (!c || !include) return c;
    if (include.shifts)
      c.shifts = await courier_shift.findMany({
        where: { courier_id: c.id, ...include.shifts.where },
      });
    const counted = include._count?.select?.orders;
    if (counted)
      c._count = {
        orders: await customer_order.count({
          where: { courier_id: c.id, ...counted.where },
        }),
      };
    return c;
  };
  const courierFindFirst = courier.findFirst;
  courier.findFirst = async (args: Row = {}) =>
    withInclude(await courierFindFirst(args), args.include);
  const courierCreate = courier.create;
  courier.create = async (args: Row) =>
    withInclude(await courierCreate(args), args.include) as Promise<Row>;
  const courierFindMany = courier.findMany;
  courier.findMany = async (args: Row = {}) =>
    Promise.all(
      (await courierFindMany(args)).map((c) => withInclude(c, args.include)),
    ) as Promise<Row[]>;
  const invitationFindUnique = courier_invitation.findUnique;
  courier_invitation.findUnique = async (args: Row) => {
    const inv = await invitationFindUnique(args);
    if (inv && args.include?.courier) {
      const c = await courier.findFirst({ where: { id: inv.courier_id } });
      if (c) c.organization = organization.get(c.organization_id);
      inv.courier = c;
    }
    return inv;
  };
  return db;
}

export type CourierDb = ReturnType<typeof makeCourierDb>;

/** A venue, a branch-less delivery order factory and couriers, ready for the bot and assignment specs. */
export async function seedVenue(db: CourierDb, name = 'Mant') {
  const org = await db.organization.create({ data: { name } });
  let number = 100;
  const order = (data: Row = {}) =>
    db.customer_order.create({
      data: {
        organization_id: org.id,
        number: ++number,
        status: 'accepted',
        branch_id: FAKE_BRANCH_ID,
        ...data,
      },
    });
  const courier = async (data: Row = {}) =>
    db.courier.create({
      data: {
        organization_id: org.id,
        name: 'Bekzod',
        phone: `+99890${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
        ...data,
      },
    });
  return { org, order, courier };
}
