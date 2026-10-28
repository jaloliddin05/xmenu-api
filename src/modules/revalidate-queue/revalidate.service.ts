import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { redisConfig } from './bull.config';
import { buildRevalidateJobId, describeRevalidate, RevalidatePayload } from './revalidate-job';

@Injectable()
export class RevalidateService implements OnModuleDestroy {
  private queue = new Queue('revalidate-queue', {
    connection: redisConfig,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 60 * 1000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });

  async addRevalidationJob(url: RevalidatePayload) {
    const jobId = buildRevalidateJobId(url);

    try {
      await this.queue.remove(jobId);
    } catch { }

    await this.queue.add('revalidate', { url }, {
      jobId,
      delay: 20 * 1000, // 20 seconds
    });
    console.log(`🧩 Job added: ${describeRevalidate(url, jobId)}`);
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}