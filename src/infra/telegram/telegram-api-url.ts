import { Env, EnvIssues, isProduction } from 'src/config/env/env-issues';

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
 * Startup check (validateEnv). Production talks to the real Telegram only: any other base would hand
 * every bot token to that host. Elsewhere the value must be an http(s) URL, and a non-default one is a
 * warning.
 */
export function telegramApiEnvIssues(env: Env = process.env): EnvIssues {
  const base = telegramApiBaseUrl(env);
  const issues: EnvIssues = { errors: [], warnings: [] };
  if (base === DEFAULT_TELEGRAM_API_BASE_URL) return issues;
  if (isProduction(env)) {
    issues.errors.push(
      `TELEGRAM_API_BASE_URL must be ${DEFAULT_TELEGRAM_API_BASE_URL} (or unset) when NODE_ENV=production`,
    );
    return issues;
  }
  let url: URL | null = null;
  try {
    url = new URL(base);
  } catch {
    // reported below
  }
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    issues.errors.push('TELEGRAM_API_BASE_URL must be an http(s) URL');
    return issues;
  }
  issues.warnings.push(
    'TELEGRAM_API_BASE_URL is not the default: Bot API calls do not go to Telegram',
  );
  return issues;
}
