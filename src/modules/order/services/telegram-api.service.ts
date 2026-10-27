import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface TelegramMessageResult {
  message_id: number;
  chat: { id: number };
}

/**
 * Telegram Bot API (HTTP). node-telegram-bot-api (otp-bot.ts) polling'siz
 * ishlaydi, lekin callback_query / editMessageText / secret_token webhooks
 * uchun yupqa va tekshiriladigan klient qulayroq. Token: TELEGRAM_BOT_TOKEN
 * (Mini App bilan bir xil bot; alohida restoran boti kerak bo'lsa
 * TELEGRAM_ORDERS_BOT_TOKEN).
 *
 * Hech bir metod throw qilmaydi: xabarnoma yuborilmasa buyurtma jarayoni
 * to'xtamasligi kerak. Muvaffaqiyatsizlik null qaytaradi va log qilinadi.
 */
@Injectable()
export class TelegramApiService {
  private readonly logger = new Logger('Telegram');
  private warned = false;

  private get token(): string | undefined {
    return process.env.TELEGRAM_ORDERS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  }

  private async call<T>(method: string, payload: Record<string, unknown>): Promise<T | null> {
    const token = this.token;
    if (!token) {
      if (!this.warned) {
        this.logger.warn('TELEGRAM_BOT_TOKEN sozlanmagan — Telegram xabarnomalari o\'chirilgan');
        this.warned = true;
      }
      return null;
    }
    try {
      const { data } = await axios.post(`https://api.telegram.org/bot${token}/${method}`, payload, { timeout: 8000 });
      return (data?.result ?? null) as T | null;
    } catch (e: any) {
      // Token URL'da — xato matniga tushib qolmasligi uchun faqat Telegram javobini loglaymiz.
      this.logger.warn(`${method} failed: ${e?.response?.data?.description ?? e?.code ?? 'unknown error'}`);
      return null;
    }
  }

  sendMessage(chatId: string | number, text: string, extra: Record<string, unknown> = {}) {
    return this.call<TelegramMessageResult>('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  }

  editMessageText(chatId: string | number, messageId: number, text: string, replyMarkup: unknown | null) {
    return this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      // Bo'sh klaviatura = tugmalarni olib tashlash
      reply_markup: replyMarkup ?? { inline_keyboard: [] },
    });
  }

  answerCallbackQuery(callbackQueryId: string, text?: string) {
    return this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: false });
  }
}
