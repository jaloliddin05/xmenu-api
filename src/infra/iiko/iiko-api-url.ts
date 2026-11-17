import { Env, EnvIssues, isProduction } from 'src/config/env/env-issues';

export const DEFAULT_IIKO_API_BASE_URL = 'https://api-ru.iiko.services';

/**
 * Base of every iiko Cloud API call: IIKO_API_BASE_URL (tests and e2e point it at a fake iiko),
 * the official address by default. Read on every call, so a test can change it at runtime.
 */
export function iikoApiBaseUrl(env: Env = process.env): string {
  const raw = env.IIKO_API_BASE_URL?.trim();
  return (raw || DEFAULT_IIKO_API_BASE_URL).replace(/\/+$/, '');
}

/**
 * Startup check (validateEnv). Production talks to the official iiko API only: any other base would
 * receive the restaurant keys and the guests' personal data. Elsewhere the value must be an http(s)
 * URL, and a non-default one is a warning.
 */
export function iikoApiEnvIssues(env: Env = process.env): EnvIssues {
  const base = iikoApiBaseUrl(env);
  const issues: EnvIssues = { errors: [], warnings: [] };
  if (base === DEFAULT_IIKO_API_BASE_URL) return issues;
  if (isProduction(env)) {
    issues.errors.push(
      `IIKO_API_BASE_URL must be ${DEFAULT_IIKO_API_BASE_URL} (or unset) when NODE_ENV=production`,
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
    issues.errors.push('IIKO_API_BASE_URL must be an http(s) URL');
    return issues;
  }
  issues.warnings.push(
    'IIKO_API_BASE_URL is not the default: iiko calls do not go to iiko',
  );
  return issues;
}
