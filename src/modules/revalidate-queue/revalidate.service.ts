import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../_prisma/prisma.service';
import { redisConfig } from './bull.config';
import {
  buildRevalidateJobId,
  describeRevalidate,
  RevalidateJob,
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

  constructor(private readonly prisma: PrismaService) {}

  /** Schedules revalidation of every front-end that shows this tenant (after 20 s, collapsing repeats). */
  async addRevalidationJob(change: TenantChange) {
    const slug =
      change.slug !== undefined
        ? change.slug
        : ((
            await this.prisma.organization.findUnique({
              where: { id: change.tenantId },
              select: { slug: true },
            })
          )?.slug ?? null);
    const clientEnabled = Boolean(process.env.CLIENT_REVALIDATE_URL?.trim());

    for (const target of targetsFor(change.route, clientEnabled)) {
      const job: RevalidateJob = { target, change: { ...change, slug } };
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
