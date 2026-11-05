/** Environment as read at startup (process.env or a test object). */
export type Env = Record<string, string | undefined>;

/**
 * Configuration problems of one area. `errors` stop production; outside production they stop only
 * when the value cannot be used at all (see validateEnv). `warnings` are printed, never fatal.
 * Texts name variables but never their values: they go to the startup log only.
 */
export interface EnvIssues {
  errors: string[];
  warnings: string[];
}

export const noIssues = (): EnvIssues => ({ errors: [], warnings: [] });

export const isProduction = (env: Env) => env.NODE_ENV === 'production';

/** A set, non-blank value. */
export const isSet = (env: Env, name: string) => Boolean(env[name]?.trim());
