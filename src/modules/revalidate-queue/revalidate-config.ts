import { Logger } from '@nestjs/common';

type Env = Record<string, string | undefined>;

/**
 * Targets that have an address but no secret. The receivers answer 503/400 to such a request and
 * the job would fail five times, so the misconfiguration is reported at startup instead.
 */
export function revalidateConfigProblems(env: Env = process.env): string[] {
  const problems: string[] = [];
  const set = (name: string) => Boolean(env[name]?.trim());
  if (set('CLIENT_REVALIDATE_URL') && !set('CLIENT_REVALIDATE_SECRET')) {
    problems.push(
      'CLIENT_REVALIDATE_URL is set but CLIENT_REVALIDATE_SECRET is empty',
    );
  }
  if (set('NEXT_PUBLIC_URL') && !set('REVALIDATE_SECRET')) {
    problems.push('NEXT_PUBLIC_URL is set but REVALIDATE_SECRET is empty');
  }
  return problems;
}

/** Production refuses to start with such a configuration; elsewhere it is a warning. */
export function assertRevalidateConfig(
  env: Env = process.env,
  logger: Pick<Logger, 'warn'> = new Logger('Revalidate'),
): void {
  const problems = revalidateConfigProblems(env);
  if (!problems.length) return;
  const text = `Front-end revalidation is misconfigured: ${problems.join('; ')} (docs/REVALIDATE.md)`;
  if (env.NODE_ENV === 'production') throw new Error(text);
  logger.warn(text);
}
