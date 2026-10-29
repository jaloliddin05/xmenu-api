import { Injectable } from '@nestjs/common';
import axios from 'axios';

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly description: string,
    readonly errorCode?: number,
  ) {
    super(`${method}: ${description}`);
  }
}

/**
 * Thin Telegram Bot API client. The bot token is part of the request URL, so it must never
 * end up in logs or error messages: errors carry only Telegram's own description.
 */
interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

@Injectable()
export class TelegramClient {
  async call<T = unknown>(
    token: string,
    method: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 8000,
  ): Promise<T> {
    try {
      const { data } = await axios.post<TelegramResponse<T>>(
        `https://api.telegram.org/bot${token}/${method}`,
        payload,
        { timeout: timeoutMs },
      );
      if (!data?.ok) {
        throw new TelegramApiError(
          method,
          data?.description ?? 'unknown error',
          data?.error_code,
        );
      }
      return data.result as T;
    } catch (e: unknown) {
      if (e instanceof TelegramApiError) throw e;
      // Never rethrow the axios error itself: its config holds the URL with the token
      const body = axios.isAxiosError<TelegramResponse<T>>(e)
        ? e.response?.data
        : undefined;
      const code = axios.isAxiosError(e) ? e.code : undefined;
      throw new TelegramApiError(
        method,
        body?.description ?? code ?? 'request failed',
        body?.error_code,
      );
    }
  }
}

/** Safe to log: Telegram's own description, never the request (its URL holds the token). */
export function telegramErrorText(e: unknown): string {
  if (e instanceof TelegramApiError) return e.description;
  return e instanceof Error ? e.message : 'unknown';
}
