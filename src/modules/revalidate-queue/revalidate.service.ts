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

@Injectable()
export class RevalidateService implements OnModuleDestroy {
  private readonly logger = new Logger(RevalidateService.name);
  private queue = new Queue('revalidate-queue', {
    connection: redisConfig,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 60 * 1000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });

  /**
   * Schedules revalidation of every front-end that shows this tenant (after 20 s, collapsing repeats).
   * Only the tenant id, route and old slug are queued; the processor reads the rest when the job runs.
   */
  async addRevalidationJob(change: TenantChange) {
    const clientEnabled = Boolean(process.env.CLIENT_REVALIDATE_URL?.trim());

    for (const target of targetsFor(change.route, clientEnabled)) {
      const job = queuedJob(target, change);
      const jobId = buildRevalidateJobId(job);
      try {
        await this.queue.remove(jobId);
      } catch {}
      await this.queue.add('revalidate', job, { jobId, delay: 20 * 1000 });
      this.logger.log(`Job added: ${describeRevalidate(job, jobId)}`);
    }
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
