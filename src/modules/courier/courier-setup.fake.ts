import type { TenantBot } from 'src/modules/telegram/telegram-bot.service';
import { OrderTransitionService } from 'src/modules/order/services/order-transition.service';
import type { OrderSettings } from 'src/modules/order/services/order-settings.service';
import { COURIER_TEXTS } from './domain/courier-texts';
import { makeCourierDb, seedVenue } from './courier-prisma.fake';
import { CourierAssignmentService } from './services/courier-assignment.service';
import { CourierBotService } from './services/courier-bot.service';
import { CourierShiftService } from './services/courier-shift.service';
import { CourierService } from './services/courier.service';

/**
 * A venue with a bot, couriers and the real OrderTransitionService on the in-memory Prisma fake, shared by
 * the courier specs. Telegram, cards, queues and notifiers are jest mocks.
 */
export const t = COURIER_TEXTS.ru;
export const ORDER_SETTINGS: OrderSettings = {
  minOrderPickup: 0,
  deliveryPriceStep: 100,
  courierMode: 'own',
  deliveryPayment: { cash: true, card: true, online: false },
  acceptanceTimeoutSeconds: 300,
  paymentTimeoutSeconds: 900,
  maxActiveOrders: 5,
  pickupReminderMinutes: 5,
  onTheWayAlertMinutes: 60,
  doorWaitMinutes: 10,
  courierPay: null,
};
export const STAFF = 'staff-user-1';
export const BRANCH_B = '33333333-3333-4333-8333-333333333333';

export async function setup() {
  const db = makeCourierDb();
  const venue = await seedVenue(db);
  const bot: TenantBot = {
    botKey: 'bot-key',
    organizationId: venue.org.id,
    telegramBotId: '777',
    username: 'mant_bot',
    token: 'secret-token',
    webhookSecretHash: '',
  };
  const telegram = {
    call: jest.fn(async (..._a: unknown[]) => ({ message_id: 1 })),
  };
  const cards = {
    refresh: jest.fn(async () => undefined),
    say: jest.fn(async () => undefined),
  };
  const queues = {
    enqueueCourierCard: jest.fn(async () => undefined),
    resetDeliveryTimers: jest.fn(async (..._a: unknown[]) => undefined),
  };
  const restaurant = {
    refreshMessage: jest.fn(async () => undefined),
    alertDeliveryProblem: jest.fn(async () => undefined),
    alertDeliveryTimer: jest.fn(async (..._a: unknown[]) => undefined),
  };
  const orderSettings = { ...ORDER_SETTINGS };
  const settings = { get: jest.fn(async () => orderSettings) };
  const customer = { notifyStatus: jest.fn(async () => undefined) };
  const transitions = new OrderTransitionService(
    db as any,
    settings as any,
    restaurant as any,
    customer as any,
    queues as any,
  );
  const bots = {
    forTenant: jest.fn(async (id: string) =>
      id === venue.org.id ? bot : null,
    ),
  };
  const shifts = new CourierShiftService(db as any, bots as any, cards as any);
  const assignments = new CourierAssignmentService(
    db as any,
    transitions,
    queues as any,
  );
  const couriers = new CourierService(
    db as any,
    bots as any,
    assignments,
    shifts,
    cards as any,
  );
  const courierBot = new CourierBotService(
    db as any,
    telegram as any,
    transitions,
    shifts,
    cards as any,
    settings as any,
  );

  let tgId = 5000;
  /** A courier linked to Telegram and on shift. */
  const onShift = async (extra: Record<string, unknown> = {}) => {
    const c = await venue.courier({
      telegram_user_id: String(++tgId),
      telegram_chat_id: String(tgId),
      ...extra,
    });
    await shifts.start(venue.org.id, c.id);
    return c;
  };
  const press = async (telegramUserId: string, data: string) => {
    telegram.call.mockClear();
    const handled = await courierBot.handleUpdate(bot, {
      callback_query: {
        id: 'cq',
        data,
        from: { id: Number(telegramUserId), language_code: 'ru' },
      },
    });
    expect(handled).toBe(true);
    const answer = telegram.call.mock.calls.find(
      (c) => c[1] === 'answerCallbackQuery',
    );
    return (answer?.[2] as { text?: string } | undefined)?.text ?? '';
  };
  const say = async (telegramUserId: string, text: string) => {
    cards.say.mockClear();
    const handled = await courierBot.handleUpdate(bot, {
      message: {
        chat: { id: Number(telegramUserId), type: 'private' },
        from: { id: Number(telegramUserId), language_code: 'ru' },
        text,
      },
    });
    const replies = cards.say.mock.calls.map(
      (c) => (c as unknown[])[2] as string,
    );
    return { handled, replies };
  };
  const order = (id: string) => db.customer_order.get(id);
  // dispatchEffects runs after the transaction without being awaited
  const flush = () => new Promise((r) => setImmediate(r));

  return {
    db,
    venue,
    bot,
    telegram,
    cards,
    queues,
    restaurant,
    orderSettings,
    transitions,
    shifts,
    assignments,
    couriers,
    courierBot,
    onShift,
    press,
    say,
    order,
    flush,
  };
}

export type Ctx = Awaited<ReturnType<typeof setup>>;
export const act = (a: string, orderId: string, extra = '') =>
  `cr:${a}:${orderId}${extra}`;
