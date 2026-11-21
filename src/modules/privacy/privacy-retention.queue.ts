import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { bullConnection } from 'src/infra/redis/bull-connection';
import { errorMessage } from 'src/infra/helper/error-text';
import { PrivacyRetentionService } from './privacy-retention.service';

export const PRIVACY_RETENTION_QUEUE = 'privacy-retention';
export const PRIVACY_RETENTION_SCHEDULER_ID = 'privacy-retention-daily';
/** Every day at 03:00 Tashkent time (the quietest hour; the SMS budget day follows the same zone) */
export const PRIVACY_RETENTION_PATTERN = '0 3 * * *';
export const PRIVACY_RETENTION_TZ = 'Asia/Tashkent';

/**
 * The scheduler is set again on every start (upsert), so a changed pattern applies after a restart and
 * several processes never double it. With ORDER_QUEUES=off (local run without Redis) nothing is scheduled.
 */
@Injectable()
export class PrivacyRetentionQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PrivacyRetention');
  readonly enabled = process.env.ORDER_QUEUES !== 'off';
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly retention: PrivacyRetentionService) {}

  private get q(): Queue {
    return (this.queue ??= new Queue(PRIVACY_RETENTION_QUEUE, {
      connection: bullConnection(),
      defaultJobOptions: { removeOnComplete: true, removeOnFail: 30 },
    }));
  }

  onModuleInit() {
    if (!this.enabled) return;
    this.worker = new Worker(
      PRIVACY_RETENTION_QUEUE,
      async () => {
        await this.retention.run();
      },
      { connection: bullConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (_job, e) =>
      this.logger.warn(`retention failed: ${errorMessage(e)}`),
    );
    void this.schedule().catch((e: unknown) =>
      this.logger.warn(`retention not scheduled: ${errorMessage(e)}`),
    );
  }

  async schedule(): Promise<void> {
    await this.q.upsertJobScheduler(
      PRIVACY_RETENTION_SCHEDULER_ID,
      { pattern: PRIVACY_RETENTION_PATTERN, tz: PRIVACY_RETENTION_TZ },
      { name: 'run', data: {} },
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
