import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { redisConfig } from './bull.config';

@Injectable()
export class RevalidateService implements OnModuleDestroy {
  private queue = new Queue('revalidate-queue', { connection: redisConfig });

  async addRevalidationJob(url: string) {
    await this.queue.add('revalidate', { url }, { 
      attempts: 3, 
      backoff: { type: 'exponential', delay: 5000 }, 
      jobId:`revalidate-${url}`,
      delay:4000,
      removeOnComplete: true,
      removeOnFail: true,
    });
    console.log(`🧩 Job added for ${url}`);
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}