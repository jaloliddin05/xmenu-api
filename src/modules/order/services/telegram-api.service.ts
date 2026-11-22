import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { telegramMethodUrl } from 'src/infra/telegram/telegram-api-url';

export interface TelegramMessageResult {
  message_id: number;
  chat: { id: number };
}

/**
 * A call that tells why it failed when the reason matters: a group that became a supergroup answers with
 * parameters.migrate_to_chat_id, the id the chat has now.
 */
export interface TelegramCallOutcome<T> {
  result: T | null;
  migrateToChatId?: string;
}

/**
 * The platform orders bot (TELEGRAM_ORDERS_BOT_TOKEN, else TELEGRAM_BOT_TOKEN): new orders and
 * their buttons in the branch chats, ops alerts. Never used for guests: they hear only from the
 * venue's own bot (notifications/customer-notifier.service.ts).
 *
 * Hech bir metod throw qilmaydi: xabarnoma yuborilmasa buyurtma jarayoni
 * to'xtamasligi kerak. Muvaffaqiyatsizlik null qaytaradi va log qilinadi.
 */
@Injectable()
export class TelegramApiService {
  private readonly logger = new Logger('Telegram');
  private warned = false;

  private get token(): string | undefined {
    return (
      process.env.TELEGRAM_ORDERS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
    );
  }

  private async call<T>(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<T | null> {
    return (await this.callWithOutcome<T>(method, payload)).result;
  }

  private async callWithOutcome<T>(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<TelegramCallOutcome<T>> {
    const token = this.token;
    if (!token) {
      if (!this.warned) {
        this.logger.warn(
          "TELEGRAM_BOT_TOKEN sozlanmagan — Telegram xabarnomalari o'chirilgan",
        );
        this.warned = true;
      }
      return { result: null };
    }
    try {
      const { data } = await axios.post<{ result?: T }>(
        telegramMethodUrl(token, method),
        payload,
        { timeout: 8000 },
      );
      return { result: (data?.result ?? null) as T | null };
    } catch (e) {
      const err = e as {
        response?: {
          data?: {
            description?: string;
            parameters?: { migrate_to_chat_id?: number };
          };
        };
        code?: string;
      };
      // Token URL'da — xato matniga tushib qolmasligi uchun faqat Telegram javobini loglaymiz.
      this.logger.warn(
        `${method} failed: ${err?.response?.data?.description ?? err?.code ?? 'unknown error'}`,
      );
      const migrated = err?.response?.data?.parameters?.migrate_to_chat_id;
      return typeof migrated === 'number'
        ? { result: null, migrateToChatId: String(migrated) }
        : { result: null };
    }
  }

  /** sendMessage that also reports a chat moved to a supergroup (the branch chat, restaurant-notifier.service.ts). */
  sendMessageWithOutcome(
    chatId: string | number,
    text: string,
    extra: Record<string, unknown> = {},
  ) {
    return this.callWithOutcome<TelegramMessageResult>(
      'sendMessage',
      this.messagePayload(chatId, text, extra),
    );
  }

  /** editMessageText that also reports a chat moved to a supergroup. */
  editMessageTextWithOutcome(
    chatId: string | number,
    messageId: number,
    text: string,
    replyMarkup: unknown,
  ) {
    return this.callWithOutcome(
      'editMessageText',
      this.editPayload(chatId, messageId, text, replyMarkup),
    );
  }

  private messagePayload(
    chatId: string | number,
    text: string,
    extra: Record<string, unknown>,
  ) {
    return {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    };
  }

  private editPayload(
    chatId: string | number,
    messageId: number,
    text: string,
    replyMarkup: unknown,
  ) {
    return {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      // Bo'sh klaviatura = tugmalarni olib tashlash
      reply_markup: replyMarkup ?? { inline_keyboard: [] },
    };
  }

  sendMessage(
    chatId: string | number,
    text: string,
    extra: Record<string, unknown> = {},
  ) {
    return this.call<TelegramMessageResult>(
      'sendMessage',
      this.messagePayload(chatId, text, extra),
    );
  }

  editMessageText(
    chatId: string | number,
    messageId: number,
    text: string,
    replyMarkup: unknown,
  ) {
    return this.call(
      'editMessageText',
      this.editPayload(chatId, messageId, text, replyMarkup),
    );
  }

  /** The bot's own account: the dashboard names it when the owner binds a branch chat. */
  getMe() {
    return this.call<{ id: number; username?: string }>('getMe', {});
  }

  answerCallbackQuery(callbackQueryId: string, text?: string) {
    return this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
      show_alert: false,
    });
  }
}
