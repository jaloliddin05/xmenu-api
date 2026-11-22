import { revalidateEnvIssues } from 'src/modules/revalidate-queue/revalidate-config';
import { domainEnvIssues } from 'src/modules/tenant-domain/domain-config';
import { telegramApiEnvIssues } from 'src/infra/telegram/telegram-api-url';
import { iikoApiEnvIssues } from 'src/infra/iiko/iiko-api-url';
import { isSmsConfigured, smsEnvIssues } from 'src/modules/sms/sms.module';
import { customerAuthEnvIssues } from 'src/modules/auth/customer-auth.config';
import { parsePaymentConfigKey } from 'src/modules/payment/domain/payment-crypto';
import { platformDomainFrom } from 'src/modules/tenant/host';
import { trustProxyEnvIssues } from 'src/infra/http/trust-proxy';
import { staffAuthEnvIssues } from '../index';
import { stepUpEnvIssues } from 'src/modules/auth/step-up/step-up.config';
import { Env, EnvIssues, isProduction, isSet } from './env-issues';

type Kind =
  | 'string'
  | 'secret'
  | 'int'
  | 'bool'
  | 'enum'
  | 'url'
  | 'host'
  | 'key32';

export interface EnvVarSpec {
  name: string;
  kind: Kind;
  /** enum: allowed values */
  values?: readonly string[];
  /** int: smallest allowed value (default 1) */
  min?: number;
  /** url: allowed protocols without the colon (default http, https) */
  protocols?: readonly string[];
  /** url: `{name}` placeholders allowed (and, with `placeholder`, required) */
  placeholder?: string;
  required?: 'always' | 'production';
  /** url: must be https when NODE_ENV=production */
  httpsInProduction?: boolean;
}

const int = (name: string, min = 1): EnvVarSpec => ({ name, kind: 'int', min });
const secret = (name: string): EnvVarSpec => ({ name, kind: 'secret' });
const str = (name: string): EnvVarSpec => ({ name, kind: 'string' });
const bool = (name: string): EnvVarSpec => ({ name, kind: 'bool' });
const url = (name: string, extra: Partial<EnvVarSpec> = {}): EnvVarSpec => ({
  name,
  kind: 'url',
  ...extra,
});

/**
 * Every environment variable the API reads (.env.example documents each one). Cross-variable rules
 * live next to the code that uses them (`*EnvIssues`) and are collected by validateEnv.
 */
export const ENV_SCHEMA: readonly EnvVarSpec[] = [
  // Core
  {
    name: 'NODE_ENV',
    kind: 'enum',
    values: ['development', 'production', 'test'],
  },
  int('PORT'),
  // format: trustProxyEnvIssues
  str('TRUST_PROXY'),
  url('DATABASE_URL', {
    required: 'always',
    protocols: ['postgresql', 'postgres'],
  }),
  url('REDIS_URL', { protocols: ['redis', 'rediss'] }),
  str('REDIS_HOST'),
  int('REDIS_PORT'),
  secret('REDIS_PASSWORD'),
  // Customer auth
  // required everywhere, length and distinctness: customerAuthEnvIssues
  secret('JWT_CUSTOMER_ACCESS_SECRET'),
  secret('JWT_CUSTOMER_REGISTRATION_SECRET'),
  secret('OTP_HMAC_SECRET'),
  int('OTP_LENGTH'),
  int('OTP_TTL_SECONDS'),
  int('OTP_MAX_ATTEMPTS'),
  int('OTP_COOLDOWN_SECONDS'),
  int('OTP_PHONE_HOURLY_LIMIT'),
  int('OTP_PHONE_DAILY_LIMIT'),
  int('OTP_IP_HOURLY_LIMIT'),
  int('STAFF_REGISTER_IP_HOURLY_LIMIT'),
  int('ACCESS_TTL_SECONDS'),
  int('REFRESH_TTL_DAYS'),
  int('SESSION_ABSOLUTE_DAYS'),
  int('REFRESH_REUSE_LEEWAY_SECONDS'),
  bool('OTP_DEV_MODE'),
  {
    name: 'SMS_PROVIDER',
    kind: 'enum',
    values: ['eskiz', 'telegram', 'console'],
  },
  str('ESKIZ_EMAIL'),
  secret('ESKIZ_PASSWORD'),
  str('ESKIZ_FROM'),
  secret('OTP_BOT'),
  str('XMENU_CHAT_ID'),
  // Daily SMS ceilings (Asia/Tashkent day): sms-budget.service.ts; unset outside production = no ceiling
  { name: 'SMS_DAILY_LIMIT_PLATFORM', kind: 'int', required: 'production' },
  { name: 'SMS_DAILY_LIMIT_TENANT', kind: 'int', required: 'production' },
  secret('TELEGRAM_BOT_TOKEN'),
  int('TELEGRAM_INITDATA_MAX_AGE_SECONDS'),
  int('TELEGRAM_VERIFY_TTL_SECONDS'),
  // format and production rule: telegramApiEnvIssues
  str('TELEGRAM_API_BASE_URL'),
  // Public URLs
  url('PUBLIC_API_URL', { required: 'production', httpsInProduction: true }),
  url('DELIVERY_URL_TEMPLATE', {
    required: 'production',
    httpsInProduction: true,
    placeholder: 'slug',
  }),
  { name: 'PLATFORM_DOMAIN', kind: 'host' },
  bool('DOMAIN_VERIFY_SKIP'),
  // format and production rule: domainEnvIssues
  str('DOMAIN_VERIFY_DNS_SERVERS'),
  url('PUBLIC_FILES_URL', { httpsInProduction: true }),
  // Orders
  secret('TELEGRAM_ORDERS_BOT_TOKEN'),
  secret('TELEGRAM_WEBHOOK_SECRET'),
  str('OPS_CHAT_ID'),
  { name: 'ORDER_QUEUES', kind: 'enum', values: ['on', 'off'] },
  // Per guest in one venue: order-limits.ts
  int('ORDER_ACTIVE_LIMIT_PER_CUSTOMER'),
  int('ORDER_HOURLY_LIMIT_PER_CUSTOMER'),
  // Retention of personal data (modules/privacy/retention-cutoffs.ts)
  int('ORDER_PII_RETENTION_DAYS'),
  int('PAYMENT_FAILED_TTL_HOURS'),
  int('APPLICATION_RETENTION_DAYS'),
  // Payments
  { name: 'PAYMENT_CONFIG_KEY', kind: 'key32', required: 'production' },
  url('MINIAPP_RETURN_URL'),
  url('MINIAPP_URL'),
  // POS (iiko): one integrator application for the whole platform
  secret('IIKO_APP_ID'),
  secret('IIKO_CLIENT_SECRET'),
  // format and production rule (official hosts, IIKO_OFFICIAL_API_HOSTS): iikoApiEnvIssues
  str('IIKO_API_BASE_URL'),
  // Menu import interval in minutes (default 30; 5 at least, a day at most: pos-sync.queue.ts)
  int('IIKO_MENU_IMPORT_MINUTES', 5),
  // Hosts iiko menu pictures may come from (empty: any public host): pos-image.store.ts
  str('IIKO_IMAGE_HOSTS'),
  // Revalidation
  url('NEXT_PUBLIC_URL'),
  secret('REVALIDATE_SECRET'),
  url('CLIENT_REVALIDATE_URL'),
  secret('CLIENT_REVALIDATE_SECRET'),
  // Staff auth
  secret('JWT_ACCESS_TOKEN_SECRET'),
  secret('STAFF_STEP_UP_SECRET'),
  str('JWT_ACCESS_TOKEN_EXPIRATION_TIME'),
  int('STAFF_REFRESH_TTL_DAYS'),
  int('STAFF_SESSION_ABSOLUTE_DAYS'),
  int('STAFF_REFRESH_REUSE_LEEWAY_SECONDS'),
  // Misc
  // /docs in production only when true (always on outside production): swagger.ts
  bool('SWAGGER_ENABLED'),
  int('HTTP_TIMEOUT'),
  int('HTTP_MAX_REDIRECTS', 0),
  int('UPLOAD_MAX_BYTES'),
  int('PUBLIC_POST_RATE_LIMIT'),
  int('PUBLIC_POST_RATE_WINDOW_SECONDS'),
  int('APPLICATION_RATE_LIMIT'),
  int('APPLICATION_RATE_WINDOW_SECONDS'),
  str('PLATFORM_ADMIN_USER_IDS'),
  secret('OPENAI_API_KEY'),
  int('TRANSLATION_RATE_LIMIT'),
  int('TRANSLATION_RATE_WINDOW_SECONDS'),
  int('TRANSLATION_IP_RATE_LIMIT'),
  int('TRANSLATION_IP_RATE_WINDOW_SECONDS'),
  int('TRANSLATION_MAX_TEXT'),
];

/** Problem with one set value, or null. Never includes the value: it may be a secret. */
function valueProblem(
  spec: EnvVarSpec,
  raw: string,
  prod: boolean,
): string | null {
  const { name } = spec;
  switch (spec.kind) {
    case 'int': {
      const n = Number(raw);
      const min = spec.min ?? 1;
      return Number.isInteger(n) && n >= min
        ? null
        : `${name} must be an integer >= ${min}`;
    }
    case 'bool':
      return raw === 'true' || raw === 'false'
        ? null
        : `${name} must be true or false`;
    case 'enum':
      return spec.values!.includes(raw)
        ? null
        : `${name} must be one of: ${spec.values!.join(', ')}`;
    case 'host':
      return platformDomainFrom({ PLATFORM_DOMAIN: raw })
        ? null
        : `${name} must be a host name (no scheme or path)`;
    case 'key32':
      try {
        parsePaymentConfigKey(raw);
        return null;
      } catch {
        return `${name} must be 32 bytes (64 hex characters or base64)`;
      }
    case 'url': {
      if (spec.placeholder && !raw.includes(`{${spec.placeholder}}`))
        return `${name} must contain {${spec.placeholder}}`;
      let parsed: URL;
      try {
        // Placeholders such as {slug} or {orderId} are not valid in a host name
        parsed = new URL(raw.replace(/\{[A-Za-z]+\}/g, 'x'));
      } catch {
        return `${name} must be a URL`;
      }
      const protocol = parsed.protocol.replace(/:$/, '');
      const allowed = spec.protocols ?? ['http', 'https'];
      if (!allowed.includes(protocol))
        return `${name} must be a ${allowed.join(' or ')} URL`;
      if (prod && spec.httpsInProduction && protocol !== 'https')
        return `${name} must be an https URL when NODE_ENV=production`;
      return null;
    }
    default:
      return null;
  }
}

/** Types and presence of every variable in ENV_SCHEMA. */
export function schemaIssues(env: Env): EnvIssues {
  const prod = isProduction(env);
  const issues: EnvIssues = { errors: [], warnings: [] };
  for (const spec of ENV_SCHEMA) {
    const raw = env[spec.name]?.trim();
    if (!raw) {
      if (
        spec.required === 'always' ||
        (spec.required === 'production' && prod)
      ) {
        issues.errors.push(
          spec.required === 'always'
            ? `${spec.name} is required`
            : `${spec.name} is required when NODE_ENV=production`,
        );
      }
      continue;
    }
    const problem = valueProblem(spec, raw, prod);
    if (problem) issues.errors.push(problem);
  }
  return issues;
}

/** Platform features that depend on configuration (the `feature` of `platform_misconfigured`, and a few more). */
export type FeatureName =
  | 'telegram_bot'
  | 'delivery_link'
  | 'sms'
  | 'domains'
  | 'payments'
  | 'translation'
  | 'revalidation'
  | 'order_notifications'
  | 'pos'
  | 'queues';

export interface FeatureStatus {
  feature: FeatureName;
  enabled: boolean;
  /** Why it is off (names variables, for the startup log only) */
  reason?: string;
}

const httpsSet = (env: Env, name: string) =>
  Boolean(env[name]?.trim().startsWith('https://'));

const keyUsable = (env: Env) => {
  try {
    parsePaymentConfigKey(env.PAYMENT_CONFIG_KEY?.trim());
    return true;
  } catch {
    return false;
  }
};

const smsUsable = (env: Env) => {
  try {
    return isSmsConfigured(env);
  } catch {
    return false; // unknown SMS_PROVIDER: reported by smsEnvIssues
  }
};

const feature = (
  name: FeatureName,
  reasons: (string | false)[],
): FeatureStatus => {
  const off = reasons.filter((r): r is string => Boolean(r));
  return off.length
    ? { feature: name, enabled: false, reason: off.join('; ') }
    : { feature: name, enabled: true };
};

/** Which configuration-dependent features work with this environment, and why not. */
export function featureStatus(env: Env): FeatureStatus[] {
  const noKey = !keyUsable(env) && 'PAYMENT_CONFIG_KEY is not a 32-byte key';
  const noHttpsApi =
    !httpsSet(env, 'PUBLIC_API_URL') && 'PUBLIC_API_URL is not https';
  const template = env.DELIVERY_URL_TEMPLATE?.trim() ?? '';
  const revalidateTargets = [
    isSet(env, 'NEXT_PUBLIC_URL') && isSet(env, 'REVALIDATE_SECRET'),
    isSet(env, 'CLIENT_REVALIDATE_URL') &&
      isSet(env, 'CLIENT_REVALIDATE_SECRET'),
  ];
  return [
    feature('telegram_bot', [noKey, noHttpsApi]),
    feature('delivery_link', [
      !template && 'DELIVERY_URL_TEMPLATE is not set',
      Boolean(template) &&
        !template.includes('{slug}') &&
        'DELIVERY_URL_TEMPLATE has no {slug}',
      Boolean(template) &&
        !template.startsWith('https://') &&
        'DELIVERY_URL_TEMPLATE is not https',
    ]),
    feature('sms', [
      env.OTP_DEV_MODE === 'true' &&
        'OTP_DEV_MODE=true: codes are not sent, the fixed test code works',
      !smsUsable(env) &&
        'the SMS provider (SMS_PROVIDER) lacks its credentials',
    ]),
    feature('domains', [
      !platformDomainFrom(env) && 'PLATFORM_DOMAIN is not a host name',
    ]),
    feature('payments', [noKey, noHttpsApi]),
    feature('translation', [
      !isSet(env, 'OPENAI_API_KEY') && 'OPENAI_API_KEY is not set',
    ]),
    feature('revalidation', [
      !revalidateTargets[0] && 'QR menu (NEXT_PUBLIC_URL + REVALIDATE_SECRET)',
      !revalidateTargets[1] &&
        'delivery site (CLIENT_REVALIDATE_URL + CLIENT_REVALIDATE_SECRET)',
    ]),
    feature('order_notifications', [
      !isSet(env, 'TELEGRAM_ORDERS_BOT_TOKEN') &&
        !isSet(env, 'TELEGRAM_BOT_TOKEN') &&
        'TELEGRAM_ORDERS_BOT_TOKEN and TELEGRAM_BOT_TOKEN are not set',
    ]),
    feature('pos', [
      noKey,
      noHttpsApi,
      (!isSet(env, 'IIKO_APP_ID') || !isSet(env, 'IIKO_CLIENT_SECRET')) &&
        'IIKO_APP_ID and IIKO_CLIENT_SECRET are not set',
    ]),
    feature('queues', [
      env.ORDER_QUEUES === 'off' &&
        'ORDER_QUEUES=off: no escalation or refund workers',
    ]),
  ];
}

export interface EnvReport extends EnvIssues {
  production: boolean;
  features: FeatureStatus[];
}

/**
 * The whole startup check. In production any error stops the API. Outside production the rules that
 * only production enforces arrive as warnings, so only unusable values and missing required secrets
 * stop it; every disabled feature is listed with its reason.
 */
export function validateEnv(env: Env = process.env): EnvReport {
  const parts = [
    schemaIssues(env),
    customerAuthEnvIssues(env),
    staffAuthEnvIssues(env),
    stepUpEnvIssues(env),
    smsEnvIssues(env),
    telegramApiEnvIssues(env),
    iikoApiEnvIssues(env),
    domainEnvIssues(env),
    revalidateEnvIssues(env),
    trustProxyEnvIssues(env),
  ];
  return {
    production: isProduction(env),
    errors: [...new Set(parts.flatMap((p) => p.errors))],
    warnings: [...new Set(parts.flatMap((p) => p.warnings))],
    features: featureStatus(env),
  };
}

/** Human-readable report for the startup log and `npm run check:env`. */
export function formatEnvReport(report: EnvReport): string[] {
  const mode = report.production ? 'production' : 'development';
  const lines = [`Configuration check (${mode}):`];
  for (const e of report.errors) lines.push(`  error: ${e}`);
  for (const w of report.warnings) lines.push(`  warning: ${w}`);
  const off = report.features.filter((f) => !f.enabled);
  if (off.length) {
    lines.push('  features off:');
    for (const f of off) lines.push(`    ${f.feature}: ${f.reason}`);
  } else {
    lines.push('  all features configured');
  }
  return lines;
}
