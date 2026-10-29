import * as dotenv from 'dotenv';

import { IConfig } from './config.interface';

dotenv.config();

const DEFAULT_ACCESS_TOKEN_SECRET = 'defaultAccessTokenSecret';

// customer-auth.config.ts requires JWT_CUSTOMER_* in production and refuses
// to boot without them. This (staff/org) config never got the same guard —
// it silently falls back to a hardcoded secret, so a misconfigured deploy
// would start up fine and sign every restaurant owner's session with a
// secret that's sitting in this repo. Only production is affected: local
// and staging keep working with no env vars set, exactly as before.
function staffTokenSecret(envVar: string, fallback: string): string {
  const value = process.env[envVar] || fallback;
  if (process.env.NODE_ENV === 'production' && value === fallback) {
    throw new Error(
      `${envVar} env o'zgaruvchisi production'da majburiy (standart qiymat ishlatib bo'lmaydi)`,
    );
  }
  return value;
}

export default (): IConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),

  jwt: {
    accessTokenExpiration: process.env.JWT_ACCESS_TOKEN_EXPIRATION_TIME || '1h',
    accessTokenSecret: staffTokenSecret(
      'JWT_ACCESS_TOKEN_SECRET',
      DEFAULT_ACCESS_TOKEN_SECRET,
    ),
  },

  newPasswordBytes: 4,
  codeBytes: 2,
});
