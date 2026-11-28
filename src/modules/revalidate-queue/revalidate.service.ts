import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { redisConfig } from './bull.config';
import {
  buildRevalidateJobId,
  describeRevalidate,
  queuedJob,
  TenantChange,
  targetsFor,
} from './revalidate-job';

/** A burst of edits within this time makes one job. */
export const REVALIDATE_DELAY_MS = 1000;
export const REVALIDATE_ATTEMPTS = 12;

@Injectable()
export class RevalidateService implements OnModuleDestroy {
  private readonly logger = new Logger(RevalidateService.name);
  private queue = new Queue('revalidate-queue', {
    connection: redisConfig,
    defaultJobOptions: {
      // Pages are cached until the backend says otherwise (no time-based refresh): a front-end that is down must
      // still get the change, so retries span about a day (30 s, 1 min, 2 min, … 17 h)
      attempts: REVALIDATE_ATTEMPTS,
      backoff: { type: 'exponential', delay: 30 * 1000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });

  /**
   * Schedules revalidation of every front-end that shows this tenant (after a second, so a burst of edits makes one
   * job). Only the tenant id, route and old slug are queued; the processor reads the rest when the job runs.
   */
  async addRevalidationJob(change: TenantChange) {
    const clientEnabled = Boolean(process.env.CLIENT_REVALIDATE_URL?.trim());

    for (const target of targetsFor(change.route, clientEnabled)) {
      const job = queuedJob(target, change);
      let jobId = buildRevalidateJobId(job);
      try {
        await this.queue.remove(jobId);
      } catch {
        // The job with this id is running right now: it may have read the old data already, so this change gets a
        // job of its own (the same id would be ignored by the queue and the change lost)
        jobId = `${jobId}-${Date.now()}`;
      }
      await this.queue.add('revalidate', job, {
        jobId,
        delay: REVALIDATE_DELAY_MS,
      });
      this.logger.log(`Job added: ${describeRevalidate(job, jobId)}`);
    }
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
