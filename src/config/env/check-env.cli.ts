/**
 * npm run check:env: the startup configuration check without starting the API. Reads .env like the
 * API does; `--production` checks the same environment as NODE_ENV=production. Exit code 1 on errors.
 */
import * as dotenv from 'dotenv';
import { formatEnvReport, validateEnv } from './env-schema';

dotenv.config({ quiet: true });

const env = process.argv.includes('--production')
  ? { ...process.env, NODE_ENV: 'production' }
  : process.env;
const report = validateEnv(env);
console.log(formatEnvReport(report).join('\n'));
process.exitCode = report.errors.length ? 1 : 0;
