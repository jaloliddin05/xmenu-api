import { Logger } from '@nestjs/common';
import { Env } from './env-issues';
import { formatEnvReport, validateEnv } from './env-schema';

/**
 * Runs validateEnv before the app is built: prints the report (errors, warnings, disabled features)
 * and throws when the API must not start.
 */
export function checkEnvAtStartup(
  env: Env = process.env,
  logger: Pick<Logger, 'log' | 'warn' | 'error'> = new Logger('Config'),
): void {
  const report = validateEnv(env);
  const lines = formatEnvReport(report);
  const write = report.errors.length
    ? (l: string) => logger.error(l)
    : report.warnings.length || report.features.some((f) => !f.enabled)
      ? (l: string) => logger.warn(l)
      : (l: string) => logger.log(l);
  lines.forEach(write);
  if (report.errors.length) {
    throw new Error(
      `Configuration check failed with ${report.errors.length} error(s), see the log above`,
    );
  }
}
