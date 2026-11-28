import { Env, EnvIssues, isProduction, isSet } from 'src/config/env/env-issues';

/** The VAPID key pair and contact of web push to staff (docs/API.md, "Web push сотрудникам"). */
export interface WebPushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const VARS = [
  'WEB_PUSH_VAPID_PUBLIC_KEY',
  'WEB_PUSH_VAPID_PRIVATE_KEY',
  'WEB_PUSH_SUBJECT',
] as const;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Bytes of a base64url value, or null when it is not base64url. */
export function base64UrlBytes(value: string): Buffer | null {
  if (!BASE64URL.test(value)) return null;
  return Buffer.from(value, 'base64url');
}

/** What is wrong with the set values (names only, never values); empty when usable. */
function problems(env: Env): string[] {
  const out: string[] = [];
  const pub = base64UrlBytes(env.WEB_PUSH_VAPID_PUBLIC_KEY!.trim());
  // An uncompressed P-256 point: 0x04, then x and y
  if (!pub || pub.length !== 65 || pub[0] !== 0x04)
    out.push(
      'WEB_PUSH_VAPID_PUBLIC_KEY must be a base64url uncompressed P-256 public key (65 bytes)',
    );
  const priv = base64UrlBytes(env.WEB_PUSH_VAPID_PRIVATE_KEY!.trim());
  if (!priv || priv.length !== 32)
    out.push(
      'WEB_PUSH_VAPID_PRIVATE_KEY must be a base64url P-256 private key (32 bytes)',
    );
  if (!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(env.WEB_PUSH_SUBJECT!.trim()))
    out.push('WEB_PUSH_SUBJECT must be a mailto: address or an https URL');
  return out;
}

/** Why web push is off with this environment, or null when it works. */
export function webPushOffReason(env: Env): string | null {
  const missing = VARS.filter((name) => !isSet(env, name));
  if (missing.length) return `${missing.join(', ')} not set`;
  const bad = problems(env);
  return bad.length ? bad.join('; ') : null;
}

/**
 * Startup check (validateEnv): production needs all three variables, well formed. Outside production push is
 * simply off without them (a warning); a set but unusable value is still an error.
 */
export function webPushEnvIssues(env: Env = process.env): EnvIssues {
  const issues: EnvIssues = { errors: [], warnings: [] };
  const missing = VARS.filter((name) => !isSet(env, name));
  if (missing.length) {
    if (isProduction(env))
      issues.errors.push(
        `${missing.join(', ')} required when NODE_ENV=production (web push to staff)`,
      );
    else if (missing.length < VARS.length)
      issues.warnings.push(
        `${missing.join(', ')} not set: web push to staff is off`,
      );
    return issues;
  }
  issues.errors.push(...problems(env));
  return issues;
}

/** The usable configuration, or null when push is off. */
export function loadWebPushConfig(
  env: Env = process.env,
): WebPushConfig | null {
  if (webPushOffReason(env)) return null;
  return {
    publicKey: env.WEB_PUSH_VAPID_PUBLIC_KEY!.trim(),
    privateKey: env.WEB_PUSH_VAPID_PRIVATE_KEY!.trim(),
    subject: env.WEB_PUSH_SUBJECT!.trim(),
  };
}
