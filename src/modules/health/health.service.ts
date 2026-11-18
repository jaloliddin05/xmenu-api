import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { errorMessage } from 'src/infra/helper/error-text';
import { REDIS } from 'src/infra/redis/redis.module';
import { PrismaService } from '../_prisma/prisma.service';
import type { CheckState, ReadinessDto } from './health.dto';

/** A dependency that does not answer within this time counts as down. */
export const CHECK_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger('Health');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async readiness(timeoutMs = CHECK_TIMEOUT_MS): Promise<ReadinessDto> {
    const [database, redis] = await Promise.all([
      this.check('database', () => this.prisma.$queryRaw`SELECT 1`, timeoutMs),
      this.check('redis', () => this.redis.ping(), timeoutMs),
    ]);
    return {
      status: database === 'up' && redis === 'up' ? 'ok' : 'unavailable',
      checks: { database, redis },
    };
  }

  private async check(
    name: string,
    probe: () => Promise<unknown>,
    timeoutMs: number,
  ): Promise<CheckState> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`no answer in ${timeoutMs} ms`)),
        timeoutMs,
      );
    });
    try {
      await Promise.race([probe(), timeout]);
      return 'up';
    } catch (e) {
      this.logger.warn(`${name} is down: ${errorMessage(e)}`);
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
