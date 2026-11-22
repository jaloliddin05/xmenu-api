import {
  parseCallback,
  TelegramOrdersController,
} from './telegram-orders.controller';
import { OrderStaffService } from '../services/order-staff.service';

const ID = '11111111-1111-1111-1111-111111111111';
const SECRET = 'webhook-secret-of-the-platform-bot';
const CHAT = -100500;

describe('parseCallback', () => {
  it('parses accept / reject / next with the status the button was drawn for', () => {
    expect(parseCallback(`o:a:pending_acceptance:${ID}`)).toEqual({
      action: { type: 'accept' },
      orderId: ID,
      expected: 'pending_acceptance',
    });
    expect(parseCallback(`o:r:pending_acceptance:${ID}`)).toEqual({
      action: { type: 'reject', reason: 'declined' },
      orderId: ID,
      expected: 'pending_acceptance',
    });
    expect(parseCallback(`o:n:preparing:${ID}`)).toEqual({
      action: { type: 'next' },
      orderId: ID,
      expected: 'preparing',
    });
  });

  it('parses the old form without a status (buttons drawn before) with no expected status', () => {
    expect(parseCallback(`o:n:${ID}`)).toEqual({
      action: { type: 'next' },
      orderId: ID,
    });
    expect(parseCallback(`o:a:${ID}`)).toEqual({
      action: { type: 'accept' },
      orderId: ID,
    });
  });

  it.each([
    undefined,
    '',
    'o:x:' + ID,
    'o:a:short',
    `o:a:${ID}; DROP TABLE`,
    `x:a:${ID}`,
    `o:a:${ID}extra`,
    `o:n:made_up:${ID}`,
    `o:n:Preparing:${ID}`,
    `o:n:preparing:accepted:${ID}`,
  ])('rejects %p', (data) => {
    expect(parseCallback(data as string)).toBeNull();
  });
});

/**
 * The webhook with an order in memory: OrderStaffService is the real one over a transition fake that moves the
 * order (version check included), so "two presses" and "one update delivered twice" run the real decision.
 */
function setup(status = 'accepted', fulfillment = 'pickup') {
  const order = {
    id: ID,
    number: 1001,
    status,
    fulfillment,
    branch: { telegram_chat_id: String(CHAT) },
  };
  const prisma = {
    customer_order: {
      findUnique: jest.fn(async () => order),
      findFirst: jest.fn(async () => ({
        status: order.status,
        fulfillment: order.fulfillment,
      })),
    },
  };
  const { InvalidTransitionError } = jest.requireActual(
    '../services/order-transition.service',
  );
  const transitions = {
    transition: jest.fn(async (input: any) => {
      if (input.expectedFrom && order.status !== input.expectedFrom)
        throw new InvalidTransitionError(order.status, input.to, 'not_allowed');
      order.status = input.to;
      return {};
    }),
  };
  const staff = new OrderStaffService(
    prisma as any,
    transitions as any,
    {} as any,
  );
  const telegram = {
    answerCallbackQuery: jest.fn(async (): Promise<unknown> => true),
    sendMessage: jest.fn(async () => ({ message_id: 1, chat: { id: CHAT } })),
  };
  const restaurant = {
    refreshMessage: jest.fn(async () => undefined),
    migrateChat: jest.fn(async () => undefined),
  };
  const keys = new Set<string>();
  const redis = {
    set: jest.fn(async (key: string) => {
      if (keys.has(key)) return null;
      keys.add(key);
      return 'OK';
    }),
  };
  const controller = new TelegramOrdersController(
    prisma as any,
    staff,
    telegram as any,
    restaurant as any,
    {} as any,
    redis as any,
  );
  const press = (data: string, updateId: number) =>
    controller.webhook(SECRET, {
      update_id: updateId,
      callback_query: {
        id: `cq-${updateId}`,
        data,
        from: { id: 7 },
        message: { chat: { id: CHAT } },
      },
    });
  return { order, controller, telegram, restaurant, transitions, redis, press };
}

describe('TelegramOrdersController webhook', () => {
  const saved = process.env.TELEGRAM_WEBHOOK_SECRET;
  beforeAll(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  });
  afterAll(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = saved;
  });

  it('the same update delivered twice is handled once', async () => {
    const s = setup('accepted');
    await s.press(`o:n:accepted:${ID}`, 501);
    await s.press(`o:n:accepted:${ID}`, 501);

    expect(s.order.status).toBe('preparing');
    expect(s.transitions.transition).toHaveBeenCalledTimes(1);
    expect(s.telegram.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(s.redis.set).toHaveBeenCalledWith(
      'tgo:upd:501',
      '1',
      'EX',
      86400,
      'NX',
    );
  });

  it('two different presses of "next" on one card take one step, the second gets "already handled" and a fresh card', async () => {
    const s = setup('accepted');
    await s.press(`o:n:accepted:${ID}`, 601);
    await s.press(`o:n:accepted:${ID}`, 602);

    expect(s.order.status).toBe('preparing');
    expect(s.telegram.answerCallbackQuery).toHaveBeenLastCalledWith(
      'cq-602',
      'Уже обработано',
    );
    expect(s.restaurant.refreshMessage).toHaveBeenCalledWith(ID);
  });

  it('a press racing another one inside the transition still moves the order once', async () => {
    const s = setup('accepted');
    // Another operator moved the order between our read and our transition
    s.transitions.transition.mockImplementationOnce(async (input: any) => {
      (s.order as any).status = 'preparing';
      const { InvalidTransitionError } = jest.requireActual(
        '../services/order-transition.service',
      );
      throw new InvalidTransitionError('preparing', input.to, 'not_allowed');
    });
    await s.press(`o:n:accepted:${ID}`, 701);
    expect(s.order.status).toBe('preparing');
    expect(s.transitions.transition.mock.calls[0][0]).toMatchObject({
      to: 'preparing',
      expectedFrom: 'accepted',
    });
  });

  it('an old button without a status changes nothing and redraws the card', async () => {
    const s = setup('accepted');
    await s.press(`o:n:${ID}`, 801);

    expect(s.order.status).toBe('accepted');
    expect(s.transitions.transition).not.toHaveBeenCalled();
    expect(s.telegram.answerCallbackQuery).toHaveBeenCalledWith(
      'cq-801',
      'Кнопка устарела, обновлено',
    );
    expect(s.restaurant.refreshMessage).toHaveBeenCalledWith(ID);
  });

  it('answers 2xx even when answerCallbackQuery fails, so Telegram does not deliver the press again', async () => {
    const s = setup('accepted');
    s.telegram.answerCallbackQuery.mockRejectedValue(new Error('network'));
    await expect(s.press(`o:n:accepted:${ID}`, 901)).resolves.toEqual({
      ok: true,
    });
    expect(s.order.status).toBe('preparing');
  });

  it('without Redis the update is still handled', async () => {
    const s = setup('accepted');
    s.redis.set.mockRejectedValueOnce(new Error('redis down'));
    await s.press(`o:n:accepted:${ID}`, 1001);
    expect(s.order.status).toBe('preparing');
  });

  it('moves the binding on the service messages of a group that became a supergroup', async () => {
    const s = setup();
    await s.controller.webhook(SECRET, {
      update_id: 1101,
      message: {
        chat: { id: -500, type: 'group' },
        migrate_to_chat_id: -1001234567890,
      },
    });
    await s.controller.webhook(SECRET, {
      update_id: 1102,
      message: {
        chat: { id: -1001234567890, type: 'supergroup' },
        migrate_from_chat_id: -500,
      },
    });
    expect(s.restaurant.migrateChat).toHaveBeenNthCalledWith(
      1,
      '-500',
      '-1001234567890',
    );
    expect(s.restaurant.migrateChat).toHaveBeenNthCalledWith(
      2,
      '-500',
      '-1001234567890',
    );
    expect(s.telegram.sendMessage).not.toHaveBeenCalled();
  });
});
