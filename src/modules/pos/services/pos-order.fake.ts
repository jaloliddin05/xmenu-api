import { PosKeyring } from './pos-keyring';

type Row = Record<string, any>;

/** where of the pos services: equality, `in`, `not`, NOT { field: value } */
export function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'NOT')
      return !Object.entries(v as Row).every(([nk, nv]) => row[nk] === nv);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
    }
    return row[k] === v;
  });
}

export const ORG = 'org-1';
export const ORDER = 'order-1';
export const INTEGRATION = 'int-1';

/**
 * One venue with iiko, one accepted delivery order of a linked branch and its pos_order row, for
 * the pos order services: the fields they read and the conditional updates they make.
 */
export function fakePosOrderWorld() {
  process.env.PAYMENT_CONFIG_KEY = 'a'.repeat(64);
  const keyring = new PosKeyring();
  const integration: Row = {
    id: INTEGRATION,
    organization_id: ORG,
    status: 'active',
    api_key_encrypted: keyring.encrypt('restaurant-key'),
    external_org_id: 'iiko-org',
    address_format: 'city',
    price_category_id: null,
    delivery_item_id: 'i-delivery',
    delivery_size_id: null,
    courier_mode: 'xmenu',
    checks: [{ key: 'key_access', status: 'ok' }],
    payment_links: [
      { method: 'cash', payment_type_id: 'pt-cash', payment_type_kind: 'Cash' },
    ],
  };
  const order: Row = {
    id: ORDER,
    organization_id: ORG,
    number: 12,
    status: 'accepted',
    fulfillment: 'delivery',
    branch_id: 'b1',
    phone: '+998901234567',
    comment: null,
    payment_method: 'cash',
    payment_status: 'not_required',
    total: 50_000,
    delivery_fee: 10_000,
    address_snapshot: {
      address: 'Tashkent, Amir Temur 1',
      latitude: 41.3,
      longitude: 69.2,
    },
    customer: { name: 'Aziz' },
    items: [
      {
        product_id: 'pizza',
        base_price: 40_000,
        quantity: 1,
        position: 0,
        options: [],
      },
    ],
  };
  const pos: Row = {
    id: 'po-1',
    order_id: ORDER,
    integration_id: INTEGRATION,
    state: 'queued',
    attempts: 0,
    correlation_id: null,
    error: null,
    pos_number: null,
    pos_status: null,
    street_id: null,
    house: null,
    courier_name: null,
    delivered_push: 'none',
    confirmed_at: null,
    alerted: null,
    sent_at: null,
    manual_at: null,
    manual_by: null,
  };
  const branchLink: Row | null = {
    branch_id: 'b1',
    integration_id: INTEGRATION,
    terminal_group_id: 'tg1',
    price_category_id: null,
  };
  const world = { integration, order, pos, branchLink, keyring };

  const withRelations = () => ({ ...pos, integration, order });
  const prisma = {
    pos_order: {
      findUnique: jest.fn(async ({ where }: Row) =>
        where.order_id === pos.order_id ? withRelations() : null,
      ),
      findUniqueOrThrow: jest.fn(async () => ({ ...pos })),
      findMany: jest.fn(async ({ where }: Row) =>
        matches(pos, {
          integration_id: where.integration_id,
          state: where.state,
        }) && matches(order, where.order ?? {})
          ? [{ order_id: pos.order_id }]
          : [],
      ),
      update: jest.fn(async ({ data }: Row) => Object.assign(pos, data)),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        if (!matches(pos, where)) return { count: 0 };
        Object.assign(pos, data);
        return { count: 1 };
      }),
    },
    pos_branch_link: {
      findUnique: jest.fn(async () => world.branchLink),
    },
    pos_menu_link: {
      findMany: jest.fn(async ({ where }: Row) =>
        where.kind === 'product'
          ? [{ product_id: 'pizza', external_id: 'i-pizza', size_id: null }]
          : [],
      ),
    },
    pos_integration: {
      findUnique: jest.fn(async () => integration),
      update: jest.fn(async ({ data }: Row) =>
        Object.assign(integration, data),
      ),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        if (!matches(integration, where)) return { count: 0 };
        Object.assign(integration, data);
        return { count: 1 };
      }),
    },
    customer_order: {
      findFirst: jest.fn(async ({ where }: Row) =>
        where.id === order.id && where.organization_id === order.organization_id
          ? { id: order.id }
          : null,
      ),
    },
  };

  const provider = {
    createOrder: jest.fn(),
    commandStatus: jest.fn(),
    confirmOrder: jest.fn(async () => 'confirm-cid'),
    setDeliveryStatus: jest.fn(),
    orders: jest.fn(async (): Promise<unknown[]> => []),
  };
  const journal: string[] = [];
  const transitions = {
    recordInTx: jest.fn(async (_tx: unknown, e: { note: string }) => {
      journal.push(e.note);
    }),
    transition: jest.fn(async (input: { to: string; note?: string }) => {
      order.status = input.to;
      journal.push(`${input.to}:${input.note ?? ''}`);
      return { order };
    }),
  };
  const restaurant = {
    alertPos: jest.fn(async () => undefined),
    alertPosReconnect: jest.fn(async () => undefined),
  };
  const queue = {
    enabled: true,
    push: jest.fn(async () => undefined),
    check: jest.fn(async () => undefined),
  };
  const alerts = {
    raise: jest.fn(async () => undefined),
    keyRejected: jest.fn(async () => false),
    platform: jest.fn(async () => undefined),
  };
  /** The iiko street directory (PosStreetsCache) */
  const streets = {
    streets: jest.fn(async (): Promise<unknown[]> => []),
    search: jest.fn(async (): Promise<unknown[]> => []),
  };
  return {
    world,
    prisma,
    provider,
    transitions,
    restaurant,
    queue,
    alerts,
    streets,
    journal,
    keyring,
  };
}
