import { RestaurantNotifierService } from './restaurant-notifier.service';

const OLD = '-500';
const NEW = '-1001234567890';

/** A branch chat that became a supergroup: Telegram answers sends to the old id with the new one. */
function setup() {
  const branches = [{ id: 'b1', telegram_chat_id: OLD }];
  const orders = [
    {
      id: 'o1',
      number: 1001,
      status: 'pending_acceptance',
      fulfillment: 'pickup',
      tg_chat_id: OLD as string | null,
      tg_message_id: 10 as number | null,
      items: [],
      branch: {
        id: 'b1',
        title: 'B',
        address: 'A',
        telegram_chat_id: OLD,
        phone: null,
      },
      currency: 'UZS',
      subtotal: 1000,
      total: 1000,
      delivery_fee: 0,
      discount: 0,
      payment_method: 'cash',
      payment_status: 'not_required',
      created_at: new Date(),
    },
  ];
  const prisma = {
    branch: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = branches.filter(
          (b) => b.telegram_chat_id === where.telegram_chat_id,
        );
        hit.forEach((b) => (b.telegram_chat_id = data.telegram_chat_id));
        return { count: hit.length };
      }),
    },
    customer_order: {
      findMany: jest.fn(async ({ where }: any) =>
        orders
          .filter((o) => o.tg_chat_id === where.tg_chat_id)
          .map((o) => ({ id: o.id })),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = orders.filter(
          (o) => o.id === where.id && o.tg_chat_id === where.tg_chat_id,
        );
        hit.forEach((o) => Object.assign(o, data));
        return { count: hit.length };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const o = orders.find((x) => x.id === where.id)!;
        Object.assign(o, data);
        return o;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const o = orders.find((x) => x.id === where.id);
        return o
          ? {
              ...o,
              branch: {
                ...o.branch,
                telegram_chat_id: branches[0].telegram_chat_id,
              },
            }
          : null;
      }),
    },
  };
  let nextId = 100;
  const migrated = { migrateToChatId: NEW, result: null };
  const telegram = {
    sendMessageWithOutcome: jest.fn(async (chatId: string) =>
      chatId === OLD
        ? migrated
        : { result: { message_id: nextId++, chat: { id: Number(chatId) } } },
    ),
    editMessageTextWithOutcome: jest.fn(async (chatId: string) =>
      chatId === OLD ? migrated : { result: true },
    ),
    sendMessage: jest.fn(async (chatId: string) =>
      chatId === OLD
        ? null
        : { message_id: nextId++, chat: { id: Number(chatId) } },
    ),
  };
  const service = new RestaurantNotifierService(prisma as any, telegram as any);
  return { service, prisma, telegram, branches, orders };
}

describe('RestaurantNotifierService and a group that became a supergroup', () => {
  it('ping answered with migrate_to_chat_id: moves the binding, posts the card of the unfinished order again and repeats the ping once', async () => {
    const s = setup();
    await s.service.ping('o1', 1);

    expect(s.branches[0].telegram_chat_id).toBe(NEW);
    expect(s.orders[0].tg_chat_id).toBe(NEW);
    // The card again (with buttons) and the ping, both in the new chat; nothing more to the old one
    const toNew = s.telegram.sendMessage.mock.calls.filter((c) => c[0] === NEW);
    expect(toNew).toHaveLength(2);
    expect(s.orders[0].tg_message_id).toBe(100);
    expect(s.telegram.sendMessageWithOutcome).toHaveBeenCalledTimes(1);
  });

  it('editing the card in the old chat moves the binding and posts the card in the new chat', async () => {
    const s = setup();
    await s.service.refreshMessage('o1');

    expect(s.branches[0].telegram_chat_id).toBe(NEW);
    expect(s.orders[0]).toMatchObject({ tg_chat_id: NEW, tg_message_id: 100 });
    expect(s.telegram.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('migrateChat is idempotent: the second service message finds nothing bound to the old id', async () => {
    const s = setup();
    await s.service.migrateChat(OLD, NEW);
    await s.service.migrateChat(OLD, NEW);

    expect(s.branches[0].telegram_chat_id).toBe(NEW);
    expect(s.telegram.sendMessage).toHaveBeenCalledTimes(1);
  });
});
