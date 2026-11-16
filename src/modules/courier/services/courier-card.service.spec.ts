import { Logger } from '@nestjs/common';
import { TelegramApiError } from 'src/modules/telegram/telegram-client';
import { COURIER_TEXTS } from '../domain/courier-texts';
import { makeCourierDb, seedVenue } from '../courier-prisma.fake';
import { CourierCardService } from './courier-card.service';
import { ORDER_SETTINGS } from '../courier-setup.fake';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

async function setup() {
  const db = makeCourierDb();
  const venue = await seedVenue(db);
  const courier = await venue.courier({
    telegram_user_id: '700',
    telegram_chat_id: '700',
    language_code: 'ru',
  });
  const order = await venue.order({
    status: 'ready',
    courier_id: courier.id,
    phone: '+998901112233',
    comment: null,
    address_snapshot: { address: 'Amir Temur 5' },
    total: 50000,
    currency: 'UZS',
    cash_change_from: null,
  });
  // the card service reads the order with its branch, guest and items
  const row = db.customer_order.get(order.id);
  Object.assign(row, {
    branch: { id: row.branch_id, title: 'Chilonzor', address: 'Bunyodkor 1' },
    customer: { name: 'Aziza' },
    items: [{ name: 'Plov', quantity: 1 }],
  });
  const bot = { token: 'tok', organizationId: venue.org.id };
  const telegram = {
    call: jest.fn(async (..._a: unknown[]) => ({ message_id: 55 })),
  };
  const service = new CourierCardService(
    db as any,
    { forTenant: async () => bot } as any,
    telegram as any,
    { get: async () => ORDER_SETTINGS } as any,
  );
  const methods = () => telegram.call.mock.calls.map((c) => c[1]);
  return { db, courier, order, row, telegram, service, methods };
}

describe('CourierCardService', () => {
  it('sends the card once, then edits the same message', async () => {
    const s = await setup();
    await s.service.refresh(s.order.id, s.courier.id);
    expect(s.methods()).toEqual(['sendMessage']);
    expect(s.db.courier_card.rows[0]).toMatchObject({
      chat_id: '700',
      message_id: 55,
    });

    s.row.status = 'on_the_way';
    await s.service.refresh(s.order.id, s.courier.id);
    expect(s.methods()).toEqual(['sendMessage', 'editMessageText']);
    const edit = s.telegram.call.mock.calls[1][2] as Record<string, unknown>;
    expect(edit).toMatchObject({ chat_id: '700', message_id: 55 });
    expect(String(edit.text)).toContain('+998901112233');
  });

  it('an unchanged card is fine; a message that cannot be edited any more is sent anew', async () => {
    const s = await setup();
    await s.service.refresh(s.order.id, s.courier.id);
    s.telegram.call.mockRejectedValueOnce(
      new TelegramApiError(
        'editMessageText',
        'Bad Request: message is not modified',
        400,
      ),
    );
    await s.service.refresh(s.order.id, s.courier.id);
    expect(s.methods()).toEqual(['sendMessage', 'editMessageText']);

    s.telegram.call.mockRejectedValueOnce(
      new TelegramApiError(
        'editMessageText',
        "Bad Request: message can't be edited",
        400,
      ),
    );
    s.telegram.call.mockResolvedValueOnce({ message_id: 77 });
    await s.service.refresh(s.order.id, s.courier.id);
    expect(s.methods().slice(2)).toEqual(['editMessageText', 'sendMessage']);
    expect(s.db.courier_card.rows).toHaveLength(1);
    expect(s.db.courier_card.rows[0].message_id).toBe(77);
  });

  it('a temporary Telegram failure is thrown so the queue retries', async () => {
    const s = await setup();
    await s.service.refresh(s.order.id, s.courier.id);
    s.telegram.call.mockRejectedValueOnce(
      new TelegramApiError('editMessageText', 'Too Many Requests', 429),
    );
    await expect(s.service.refresh(s.order.id, s.courier.id)).rejects.toThrow(
      'Too Many Requests',
    );
  });

  it('taken off the courier: the card is shortened (no phone, no address) and the courier is told', async () => {
    const s = await setup();
    await s.service.refresh(s.order.id, s.courier.id);
    s.row.courier_id = null;
    await s.service.refresh(s.order.id, s.courier.id);
    const [, , edit] = s.telegram.call.mock.calls[1] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(edit.text).toBe(
      `Заказ №${s.order.number}\n${COURIER_TEXTS.ru.status.taken_off}`,
    );
    expect(edit.reply_markup).toEqual({ inline_keyboard: [] });
    const told = s.telegram.call.mock.calls[2][2] as Record<string, unknown>;
    expect(told.text).toBe(COURIER_TEXTS.ru.unassigned(s.order.number));
  });

  it('a finished order whose card was never sent sends nothing; a courier without Telegram gets nothing', async () => {
    const s = await setup();
    s.row.status = 'cancelled';
    await s.service.refresh(s.order.id, s.courier.id);
    s.db.courier.get(s.courier.id).telegram_chat_id = null;
    s.row.status = 'ready';
    await s.service.refresh(s.order.id, s.courier.id);
    expect(s.telegram.call).not.toHaveBeenCalled();
  });

  it("never shows a card of another venue's order", async () => {
    const s = await setup();
    s.row.organization_id = 'other';
    await s.service.refresh(s.order.id, s.courier.id);
    expect(s.telegram.call).not.toHaveBeenCalled();
  });
});
