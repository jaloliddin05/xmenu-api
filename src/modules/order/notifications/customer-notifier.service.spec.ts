import 'reflect-metadata';
import { TelegramApiError } from 'src/modules/telegram/telegram-client';
import { SMS_PROVIDER } from 'src/modules/sms/providers/sms-provider.interface';
import { GuestNotificationProcessor } from '../queue/guest-notification.processor';
import {
  CustomerNotifierService,
  GuestNotificationRetry,
} from './customer-notifier.service';

const VENUE_BOT = { telegramBotId: '111111', token: '111111:VENUE' };

type Order = {
  number: number;
  status: string;
  payment_method: string;
  payment_status: string;
  cancelled_by: string | null;
  organization_id: string;
  customer_id: string;
  channel: 'site' | 'miniapp';
  guest_telegram_id: string | null;
  guest_telegram_bot_id: string | null;
  customer: { language: string | null; telegram_id: string | null };
};

function setup(over: Partial<Order> = {}) {
  const order: Order = {
    number: 1001,
    status: 'accepted',
    payment_method: 'cash',
    payment_status: 'not_required',
    cancelled_by: null,
    organization_id: 'org-1',
    customer_id: 'cust-1',
    channel: 'miniapp',
    guest_telegram_id: '555',
    guest_telegram_bot_id: VENUE_BOT.telegramBotId,
    customer: { language: 'ru', telegram_id: '555' },
    ...over,
  };
  let bot: typeof VENUE_BOT | null = VENUE_BOT;
  const prisma = {
    customer_order: { findUnique: jest.fn(async () => order) },
    organization_settings: {
      findUnique: jest.fn(async () => ({
        default_language: 'ru',
        languages: ['ru', 'uz', 'en'],
      })),
    },
    customer: {
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const bots = { forTenant: jest.fn(async () => bot) };
  const telegram = { call: jest.fn(async (..._args: unknown[]) => ({})) };
  const queues = {
    enqueueGuestNotification: jest.fn(async (..._args: unknown[]) => true),
  };
  const notifier = new CustomerNotifierService(
    prisma as any,
    bots as any,
    telegram as any,
    queues as any,
  );
  const processor = new GuestNotificationProcessor(notifier);
  /** Runs one queue attempt of the job the notifier enqueued. */
  const runJob = (attemptsMade: number) =>
    processor.process({
      data: queues.enqueueGuestNotification.mock.calls[0][0],
      attemptsMade,
      opts: { attempts: 5 },
    } as any);
  return {
    order,
    prisma,
    bots,
    telegram,
    queues,
    notifier,
    runJob,
    setBot: (b: typeof VENUE_BOT | null) => (bot = b),
    marked: () =>
      prisma.customer.update.mock.calls.map(
        (c: any[]) => c[0].data.telegram_unreachable_reason,
      ),
  };
}

describe('CustomerNotifierService: guest order notifications', () => {
  it('site order: nothing is queued or sent, even though the guest has a telegram_id', async () => {
    const t = setup({
      channel: 'site',
      guest_telegram_id: null,
      guest_telegram_bot_id: null,
    });
    await t.notifier.notifyStatus('o1', 'pending_acceptance');
    await t.notifier.notifyRefunded('o1');
    expect(t.queues.enqueueGuestNotification).not.toHaveBeenCalled();
    expect(t.telegram.call).not.toHaveBeenCalled();
    expect(t.prisma.customer.update).not.toHaveBeenCalled();
  });

  it('Mini App order: queued, then sent by the venue bot to the guest from initData', async () => {
    const t = setup();
    await t.notifier.notifyStatus('o1', 'pending_acceptance');
    expect(t.queues.enqueueGuestNotification).toHaveBeenCalledWith({
      orderId: 'o1',
      text: expect.stringContaining('1001'),
    });
    expect(t.telegram.call).not.toHaveBeenCalled();

    await t.runJob(0);
    expect(t.telegram.call).toHaveBeenCalledWith(
      VENUE_BOT.token,
      'sendMessage',
      expect.objectContaining({ chat_id: '555' }),
    );
    expect(t.prisma.customer.update).not.toHaveBeenCalled();
    // A delivered notification clears an old "unreachable" mark
    expect(t.prisma.customer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          telegram_unreachable_at: null,
          telegram_unreachable_reason: null,
        },
      }),
    );
  });

  it('refund of a Mini App order goes the same way', async () => {
    const t = setup({ status: 'cancelled' });
    await t.notifier.notifyRefunded('o1');
    await t.runJob(0);
    expect(t.telegram.call).toHaveBeenCalledWith(
      VENUE_BOT.token,
      'sendMessage',
      expect.objectContaining({ chat_id: '555' }),
    );
  });

  it('the venue has no bot any more: not sent, the guest is marked no_venue_bot', async () => {
    const t = setup();
    t.setBot(null);
    await t.notifier.notifyStatus('o1', 'pending_acceptance');
    await t.runJob(0);
    expect(t.telegram.call).not.toHaveBeenCalled();
    expect(t.marked()).toEqual(['no_venue_bot']);
  });

  it('the venue bot cannot be decrypted: treated as no bot, not thrown', async () => {
    const t = setup();
    t.bots.forTenant.mockRejectedValueOnce(new Error('cannot decrypt'));
    await t.notifier.notifyStatus('o1', 'pending_acceptance');
    await t.runJob(0);
    expect(t.telegram.call).not.toHaveBeenCalled();
    expect(t.marked()).toEqual(['no_venue_bot']);
  });

  it('the venue connected another bot: not sent, marked bot_changed', async () => {
    const t = setup();
    t.setBot({ telegramBotId: '222222', token: '222222:OTHER' });
    await t.notifier.notifyStatus('o1', 'pending_acceptance');
    await t.runJob(0);
    expect(t.telegram.call).not.toHaveBeenCalled();
    expect(t.marked()).toEqual(['bot_changed']);
  });

  it('Telegram 403 (bot blocked or never started): no retry, marked forbidden', async () => {
    const t = setup();
    t.telegram.call.mockRejectedValueOnce(
      new TelegramApiError(
        'sendMessage',
        'Forbidden: bot was blocked by the user',
        403,
      ),
    );
    await t.notifier.notifyStatus('o1', 'pending_acceptance');
    await expect(t.runJob(0)).resolves.toBeUndefined();
    expect(t.telegram.call).toHaveBeenCalledTimes(1);
    expect(t.marked()).toEqual(['forbidden']);
  });

  it('temporary failure: the job fails for a retry, the next attempt delivers', async () => {
    const t = setup();
    t.telegram.call.mockRejectedValueOnce(
      new TelegramApiError('sendMessage', 'Too Many Requests', 429),
    );
    await t.notifier.notifyStatus('o1', 'pending_acceptance');
    await expect(t.runJob(0)).rejects.toBeInstanceOf(GuestNotificationRetry);
    expect(t.prisma.customer.update).not.toHaveBeenCalled();

    await t.runJob(1);
    expect(t.telegram.call).toHaveBeenCalledTimes(2);
    expect(t.prisma.customer.update).not.toHaveBeenCalled();
  });

  it('temporary failure on the last attempt: gives up, marked retries_exhausted', async () => {
    const t = setup();
    t.telegram.call.mockRejectedValue(
      new TelegramApiError('sendMessage', 'ETIMEDOUT'),
    );
    await t.notifier.notifyStatus('o1', 'pending_acceptance');
    await expect(t.runJob(4)).resolves.toBeUndefined();
    expect(t.marked()).toEqual(['retries_exhausted']);
  });

  it('without a queue (ORDER_QUEUES=off) it sends at once, one attempt', async () => {
    const t = setup();
    t.queues.enqueueGuestNotification.mockResolvedValue(false);
    t.telegram.call.mockRejectedValue(
      new TelegramApiError('sendMessage', 'Bad Gateway', 502),
    );
    await t.notifier.notifyStatus('o1', 'pending_acceptance');
    expect(t.telegram.call).toHaveBeenCalledTimes(1);
    expect(t.marked()).toEqual(['retries_exhausted']);
  });

  it('a status without a guest text (placed, cash) queues nothing', async () => {
    const t = setup({ status: 'pending_acceptance' });
    await t.notifier.notifyStatus('o1', null);
    expect(t.queues.enqueueGuestNotification).not.toHaveBeenCalled();
  });

  it('never sends an SMS: neither the notifier nor its worker can reach the SMS provider', () => {
    const tokens = (cls: object) => [
      ...((Reflect.getMetadata('design:paramtypes', cls) as unknown[]) ?? []),
      ...(
        (Reflect.getMetadata('self:paramtypes', cls) as
          | { param: unknown }[]
          | undefined) ?? []
      ).map((p) => p.param),
    ];
    for (const cls of [CustomerNotifierService, GuestNotificationProcessor])
      expect(tokens(cls)).not.toContain(SMS_PROVIDER);
    expect(tokens(CustomerNotifierService).length).toBeGreaterThan(0);
  });
});
