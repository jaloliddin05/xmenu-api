import { Env, EnvIssues, isProduction } from 'src/config/env/env-issues';

/** Signing secret of the step-up tokens; outside production a built-in one keeps local runs working. */
const DEFAULT_STEP_UP_SECRET = 'defaultStaffStepUpSecret';

const OTHER_SECRETS = [
  'JWT_ACCESS_TOKEN_SECRET',
  'JWT_CUSTOMER_ACCESS_SECRET',
  'JWT_CUSTOMER_REGISTRATION_SECRET',
  'OTP_HMAC_SECRET',
] as const;

/**
 * Startup check (validateEnv): production needs its own STAFF_STEP_UP_SECRET of at least 32 characters, distinct
 * from every other auth secret (a step-up token must never verify as another kind of token, and back).
 */
export function stepUpEnvIssues(env: Env = process.env): EnvIssues {
  const issues: EnvIssues = { errors: [], warnings: [] };
  const v = env.STAFF_STEP_UP_SECRET;
  if (!isProduction(env)) {
    if (!v)
      issues.warnings.push(
        'STAFF_STEP_UP_SECRET is not set: step-up tokens are signed with a built-in development secret',
      );
    return issues;
  }
  if (!v || v === DEFAULT_STEP_UP_SECRET) {
    issues.errors.push(
      'STAFF_STEP_UP_SECRET is required when NODE_ENV=production',
    );
    return issues;
  }
  if (v.length < 32)
    issues.errors.push(
      'STAFF_STEP_UP_SECRET must be at least 32 characters when NODE_ENV=production',
    );
  if (OTHER_SECRETS.some((name) => env[name] === v))
    issues.errors.push(
      'STAFF_STEP_UP_SECRET must differ from the other JWT and OTP secrets',
    );
  return issues;
}

export function loadStepUpSecret(): string {
  // Also checked by validateEnv at startup; kept here so the token service never builds with a bad secret
  const { errors } = stepUpEnvIssues(process.env);
  if (errors.length) throw new Error(errors.join('; '));
  return process.env.STAFF_STEP_UP_SECRET || DEFAULT_STEP_UP_SECRET;
}
