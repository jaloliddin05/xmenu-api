import { Worker } from 'bullmq';
import axios from 'axios';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { redisConfig } from './bull.config';
import {
  buildClientBody,
  buildQrBody,
  describeRevalidate,
  RevalidateJob,
} from './revalidate-job';

/** Where a job goes and what it sends; null when the target has nothing to do. */
export function revalidateRequest(
  job: RevalidateJob,
  env = process.env,
): { url: string; body: object } | null {
  if (job.target === 'client') {
    const url = env.CLIENT_REVALIDATE_URL?.trim();
    return url
      ? { url, body: buildClientBody(job.change, env.CLIENT_REVALIDATE_SECRET) }
      : null;
  }
  const body = buildQrBody(job.change, env.REVALIDATE_SECRET);
  return body ? { url: `${env.NEXT_PUBLIC_URL}/api/revalidate`, body } : null;
}

@Injectable()
export class RevalidateProcessor implements OnModuleDestroy {
  private readonly logger = new Logger('Revalidate');
  private worker: Worker;

  constructor() {
    this.worker = new Worker(
      'revalidate-queue',
      async (job) => {
        const data = job.data as RevalidateJob;
        const what = describeRevalidate(data, job.id);
        const request = data?.change ? revalidateRequest(data) : null;
        if (!request) {
          this.logger.log(`Skipped: ${what}`);
          return { success: true, skipped: true };
        }

        try {
          const response = await axios.post(request.url, request.body);
          if (response.status !== 200)
            throw new Error(`Unexpected status: ${response.status}`);
          return { success: true };
        } catch (error) {
          this.logger.error(`Failed: ${what}: ${(error as Error).message}`);
          throw error;
        }
      },
      { connection: redisConfig },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Done: ${describeRevalidate(job.data ?? {}, job.id)}`);
    });
  }

  async onModuleDestroy() {
    await this.worker.close();
  }
}
