import * as dotenv from 'dotenv';

import { IConfig } from './config.interface';
import { Env, EnvIssues, isProduction } from './env/env-issues';

dotenv.config();

const DEFAULT_ACCESS_TOKEN_SECRET = 'defaultAccessTokenSecret';

const MIN_SECRET_LENGTH = 32;

/**
 * Startup check (validateEnv): the staff JWT secret falls back to a built-in default for local runs,
 * which production refuses (every owner session would be signed with a secret from this repository),
 * and in production it must be long enough not to be guessed (HS256).
 */
export function staffAuthEnvIssues(env: Env = process.env): EnvIssues {
  const v = env.JWT_ACCESS_TOKEN_SECRET;
  const missing = !v || v === DEFAULT_ACCESS_TOKEN_SECRET;
  const errors: string[] = [];
  if (isProduction(env)) {
    if (missing)
      errors.push(
        'JWT_ACCESS_TOKEN_SECRET is required when NODE_ENV=production',
      );
    else if (v.length < MIN_SECRET_LENGTH)
      errors.push(
        `JWT_ACCESS_TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters when NODE_ENV=production`,
      );
  }
  return { errors, warnings: [] };
}

export default (): IConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),

  jwt: {
    accessTokenExpiration: process.env.JWT_ACCESS_TOKEN_EXPIRATION_TIME || '1h',
    accessTokenSecret:
      process.env.JWT_ACCESS_TOKEN_SECRET || DEFAULT_ACCESS_TOKEN_SECRET,
  },

  newPasswordBytes: 4,
  codeBytes: 2,
});
