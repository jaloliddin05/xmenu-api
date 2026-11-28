import { Worker } from 'bullmq';
import axios from 'axios';
import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { LiveEventBus } from '../live/live-event-bus';
import { PrismaService } from '../_prisma/prisma.service';
import { redisConfig } from './bull.config';
import {
  buildClientBody,
  buildQrBody,
  describeRevalidate,
  ResolvedChange,
  RevalidateJob,
  RevalidateRoute,
} from './revalidate-job';

/** What an open guest page refetches after a change of this kind (content.changed). */
export const CONTENT_SCOPES: Record<RevalidateRoute, string[]> = {
  menu: ['menu'],
  organization: ['config'],
  settings: ['config'],
  branches: ['branches'],
  channels: ['config'],
  domains: [],
};

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

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly live?: LiveEventBus,
  ) {
    this.worker = new Worker(
      'revalidate-queue',
      async (job) => {
        const data = job.data as RevalidateJob;
        const what = describeRevalidate(data, job.id);
        const request = await this.requestFor(data);
        if (!request) {
          this.logger.log(`Skipped: ${what}`);
          await this.refreshed(data);
          return { success: true, skipped: true };
        }

        try {
          const response = await axios.post(request.url, request.body);
          if (response.status !== 200)
            throw new Error(`Unexpected status: ${response.status}`);
          await this.refreshed(data);
          return { success: true };
        } catch (error) {
          this.logger.error(`Failed: ${what}: ${(error as Error).message}`);
          throw error;
        }
      },
      { connection: redisConfig },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(
        `Done: ${describeRevalidate(
          (job.data ?? {}) as Partial<RevalidateJob>,
          job.id,
        )}`,
      );
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

  /**
   * The cached pages of this front-end are fresh now: its open pages refetch (an earlier event would make them
   * refetch the old page). docs/API.md, "События (SSE)".
   */
  private async refreshed(data: RevalidateJob) {
    const scopes = CONTENT_SCOPES[data.change.route] ?? [];
    if (!scopes.length || !data.change.tenantId) return;
    await this.live?.publish(data.change.tenantId, {
      type: 'content.changed',
      data: { scopes, target: data.target },
      to: ['public'],
    });
  }

  async onModuleDestroy() {
    await this.worker.close();
  }
}
