import { Worker } from 'bullmq';
import axios from 'axios';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../_prisma/prisma.service';
import { redisConfig } from './bull.config';
import {
  buildClientBody,
  buildQrBody,
  describeRevalidate,
  ResolvedChange,
  RevalidateJob,
} from './revalidate-job';

/** Where a job goes and what it sends; null when the target has nothing to do. */
export function revalidateRequest(
  job: { target: RevalidateJob['target']; change: ResolvedChange },
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

  constructor(private readonly prisma: PrismaService) {
    this.worker = new Worker(
      'revalidate-queue',
      async (job) => {
        const data = job.data as RevalidateJob;
        const what = describeRevalidate(data, job.id);
        const request = await this.requestFor(data);
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

  /**
   * The request for a job as of now: the slug is read by tenant id here, not taken from queuing time,
   * so a retry after a rename addresses the new slug. A tenant that no longer exists has nothing to refresh.
   */
  async requestFor(data: RevalidateJob | undefined) {
    if (!data?.change?.tenantId) return null;
    const org = await this.prisma.organization.findUnique({
      where: { id: data.change.tenantId },
      select: { slug: true },
    });
    if (!org) return null;
    return revalidateRequest({
      ...data,
      change: { ...data.change, slug: org.slug ?? null },
    });
  }

  async onModuleDestroy() {
    await this.worker.close();
  }
}
