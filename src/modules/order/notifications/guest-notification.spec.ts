import { TelegramApiError } from 'src/modules/telegram/telegram-client';
import { guestTarget, orderSource, sendFailure } from './guest-notification';

describe('orderSource', () => {
  it('no Mini App visit: a site order without Telegram ids', () => {
    expect(orderSource(null)).toEqual({
      channel: 'site',
      guest_telegram_id: null,
      guest_telegram_bot_id: null,
    });
  });

  it('a checked Mini App visit: the guest and the venue bot', () => {
    expect(orderSource({ user: { id: 555 }, telegramBotId: '111111' })).toEqual(
      {
        channel: 'miniapp',
        guest_telegram_id: '555',
        guest_telegram_bot_id: '111111',
      },
    );
  });
});

describe('guestTarget', () => {
  const miniapp = {
    channel: 'miniapp' as const,
    guest_telegram_id: '555',
    guest_telegram_bot_id: '111111',
  };

  it('site order: nobody, whatever the bot', () => {
    expect(
      guestTarget(
        {
          channel: 'site',
          guest_telegram_id: null,
          guest_telegram_bot_id: null,
        },
        { telegramBotId: '111111' },
      ),
    ).toEqual({ kind: 'none' });
  });

  it('the same venue bot: the guest from initData', () => {
    expect(guestTarget(miniapp, { telegramBotId: '111111' })).toEqual({
      kind: 'send',
      chatId: '555',
    });
  });

  it('no bot / another bot: unreachable with the reason', () => {
    expect(guestTarget(miniapp, null)).toEqual({
      kind: 'unreachable',
      reason: 'no_venue_bot',
    });
    expect(guestTarget(miniapp, { telegramBotId: '222222' })).toEqual({
      kind: 'unreachable',
      reason: 'bot_changed',
    });
  });
});

describe('sendFailure', () => {
  const err = (code: number | undefined, text = 'x') =>
    new TelegramApiError('sendMessage', text, code);

  it.each([
    [403, 'Forbidden: bot was blocked by the user', 'forbidden'],
    [400, 'Bad Request: chat not found', 'chat_not_found'],
    [400, "Bad Request: can't parse entities", 'rejected'],
    [404, 'Not Found', 'rejected'],
  ])('%s %s: final, %s', (code, text, reason) => {
    expect(sendFailure(err(code, text))).toEqual({ kind: 'final', reason });
  });

  it.each([
    [429, 'Too Many Requests'],
    [500, 'Internal Server Error'],
    [502, 'Bad Gateway'],
    [undefined, 'ETIMEDOUT'],
  ])('%s %s: retry', (code, text) => {
    expect(sendFailure(err(code, text))).toEqual({ kind: 'retry' });
  });

  it('a non-Telegram error is retried', () => {
    expect(sendFailure(new Error('socket hang up'))).toEqual({ kind: 'retry' });
  });
});
