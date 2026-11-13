import type { MiniAppVisit } from 'src/modules/auth/services/mini-app-access.service';
import { TelegramApiError } from 'src/modules/telegram/telegram-client';

/**
 * Order notifications to the guest (status changes, refunds): docs/API.md, "Уведомления гостю".
 * Only orders placed in the venue's Mini App get them, only from the venue bot that opened that
 * Mini App, only to the guest's Telegram id from that initData. Site orders get none: the guest
 * sees the status on the order timeline. There is no SMS fallback.
 */

/** Why a notification did not reach the guest (stored on the customer and logged). */
export type GuestUnreachableReason =
  /** The venue has no usable bot now: disconnected, disabled or its token cannot be decrypted */
  | 'no_venue_bot'
  /** The venue connected another bot than the one the guest ordered through */
  | 'bot_changed'
  /** Telegram 403: the guest blocked the bot or never started it */
  | 'forbidden'
  /** Telegram 400 "chat not found" */
  | 'chat_not_found'
  /** Any other Telegram 4xx: retrying the same request cannot help */
  | 'rejected'
  /** Temporary failures (429, 5xx, network) on every attempt */
  | 'retries_exhausted';

export type OrderChannelName = 'site' | 'miniapp';

/** Columns POST /orders writes: where the order came from and whom to notify. */
export function orderSource(visit: MiniAppVisit | null): {
  channel: OrderChannelName;
  guest_telegram_id: string | null;
  guest_telegram_bot_id: string | null;
} {
  if (!visit)
    return {
      channel: 'site',
      guest_telegram_id: null,
      guest_telegram_bot_id: null,
    };
  return {
    channel: 'miniapp',
    guest_telegram_id: String(visit.user.id),
    guest_telegram_bot_id: visit.telegramBotId,
  };
}

export interface GuestOrderTarget {
  channel: OrderChannelName;
  guest_telegram_id: string | null;
  guest_telegram_bot_id: string | null;
}

export type GuestTarget =
  | { kind: 'none' }
  | { kind: 'unreachable'; reason: GuestUnreachableReason }
  | { kind: 'send'; chatId: string };

/** Whom to message for this order, given the venue's bot right now (null: no usable bot). */
export function guestTarget(
  order: GuestOrderTarget,
  bot: { telegramBotId: string } | null,
): GuestTarget {
  if (
    order.channel !== 'miniapp' ||
    !order.guest_telegram_id ||
    !order.guest_telegram_bot_id
  )
    return { kind: 'none' };
  if (!bot) return { kind: 'unreachable', reason: 'no_venue_bot' };
  if (bot.telegramBotId !== order.guest_telegram_bot_id)
    return { kind: 'unreachable', reason: 'bot_changed' };
  return { kind: 'send', chatId: order.guest_telegram_id };
}

/** A failed sendMessage: give up with a reason, or try again later. */
export function sendFailure(
  e: unknown,
): { kind: 'final'; reason: GuestUnreachableReason } | { kind: 'retry' } {
  const status = e instanceof TelegramApiError ? e.errorCode : undefined;
  if (status === 403) return { kind: 'final', reason: 'forbidden' };
  if (status === 400 && e instanceof TelegramApiError) {
    return /chat not found/i.test(e.description)
      ? { kind: 'final', reason: 'chat_not_found' }
      : { kind: 'final', reason: 'rejected' };
  }
  if (status !== undefined && status >= 400 && status < 500 && status !== 429)
    return { kind: 'final', reason: 'rejected' };
  return { kind: 'retry' };
}
