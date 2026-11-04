import { Logger } from '@nestjs/common';

type Env = Record<string, string | undefined>;

export const DEFAULT_TELEGRAM_API_BASE_URL = 'https://api.telegram.org';

/**
 * Base of every Bot API call: TELEGRAM_API_BASE_URL (tests and e2e point it at a fake Telegram),
 * https://api.telegram.org by default. Read on every call, so a test can change it at runtime.
 */
export function telegramApiBaseUrl(env: Env = process.env): string {
  const raw = env.TELEGRAM_API_BASE_URL?.trim();
  return (raw || DEFAULT_TELEGRAM_API_BASE_URL).replace(/\/+$/, '');
}

/** `{base}/bot{token}/{method}`: the token is in the URL, so never log the result. */
export function telegramMethodUrl(
  token: string,
  method: string,
  env: Env = process.env,
): string {
  return `${telegramApiBaseUrl(env)}/bot${token}/${method}`;
}

/**
 * Startup check. Production talks to the real Telegram only: any other base would hand every bot
 * token to that host. Elsewhere the value must be an http(s) URL, and a non-default one is a warning.
 */
export function assertTelegramApiConfig(
  env: Env = process.env,
  logger: Pick<Logger, 'warn'> = new Logger('TelegramApi'),
): string {
  const base = telegramApiBaseUrl(env);
  if (base === DEFAULT_TELEGRAM_API_BASE_URL) return base;
  if (env.NODE_ENV === 'production') {
    throw new Error(
      `TELEGRAM_API_BASE_URL must be ${DEFAULT_TELEGRAM_API_BASE_URL} (or unset) when NODE_ENV=production`,
    );
  }
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error('TELEGRAM_API_BASE_URL is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('TELEGRAM_API_BASE_URL must be an http(s) URL');
  }
  logger.warn(
    `TELEGRAM_API_BASE_URL=${base}: Bot API calls do not go to Telegram`,
  );
  return base;
}
