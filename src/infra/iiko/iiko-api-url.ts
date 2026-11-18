import { Env, EnvIssues, isProduction } from 'src/config/env/env-issues';

export const DEFAULT_IIKO_API_BASE_URL = 'https://api-ru.iiko.services';

/**
 * Official iiko Cloud API hosts allowed in production (audit W15-17). Only api-ru is confirmed by the
 * iiko documentation so far; when iiko names another address for Uzbekistan (docs/IIKO.md, "Открытые
 * вопросы"), add its host here: production then accepts IIKO_API_BASE_URL=https://<that host>.
 */
export const IIKO_OFFICIAL_API_HOSTS: readonly string[] = [
  'api-ru.iiko.services',
];

/** https://<official host>, nothing else: no port, path, query or credentials. */
function isOfficialIikoBase(base: string): boolean {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    IIKO_OFFICIAL_API_HOSTS.includes(url.hostname) &&
    !url.port &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash
  );
}

/**
 * Base of every iiko Cloud API call: IIKO_API_BASE_URL (tests and e2e point it at a fake iiko),
 * the official address by default. Read on every call, so a test can change it at runtime.
 */
export function iikoApiBaseUrl(env: Env = process.env): string {
  const raw = env.IIKO_API_BASE_URL?.trim();
  return (raw || DEFAULT_IIKO_API_BASE_URL).replace(/\/+$/, '');
}

/**
 * Startup check (validateEnv). Production talks to an official iiko API host only
 * (IIKO_OFFICIAL_API_HOSTS): any other base would receive the restaurant keys and the guests'
 * personal data. Elsewhere the value must be an http(s) URL, and an unofficial one is a warning.
 */
export function iikoApiEnvIssues(env: Env = process.env): EnvIssues {
  const base = iikoApiBaseUrl(env);
  const issues: EnvIssues = { errors: [], warnings: [] };
  if (isOfficialIikoBase(base)) return issues;
  if (isProduction(env)) {
    issues.errors.push(
      `IIKO_API_BASE_URL must be https://<an official iiko host: ${IIKO_OFFICIAL_API_HOSTS.join(', ')}> (or unset) when NODE_ENV=production`,
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
