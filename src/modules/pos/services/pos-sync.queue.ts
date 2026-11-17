import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { bullConnection } from 'src/infra/redis/bull-connection';
import { errorMessage } from 'src/infra/helper/error-text';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { PosMenuImportService } from './pos-menu-import.service';
import { PosStopListService } from './pos-stop-list.service';

export const POS_SYNC_QUEUE = 'pos-sync';
/** Menu import interval (docs/IIKO.md: no webhook announces a changed external menu) */
export const MENU_IMPORT_EVERY_MS = 30 * 60_000;

export type PosSyncJobName = 'menu' | 'stop-list';
export interface PosSyncJob {
  integrationId: string;
}

const schedulerId = (integrationId: string) => `pos-menu-${integrationId}`;

/**
 * Menu imports and stop list refreshes run here (one pending menu import per integration). Every
 * active integration has a scheduler that imports its menu every 30
 * minutes. With ORDER_QUEUES=off (local run without Redis) the work runs in the calling request.
 */
@Injectable()
export class PosSyncQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PosSync');
  readonly enabled = process.env.ORDER_QUEUES !== 'off';
  private queue?: Queue<PosSyncJob>;
  private worker?: Worker<PosSyncJob>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly menu: PosMenuImportService,
    private readonly stopList: PosStopListService,
  ) {}

  private get q(): Queue<PosSyncJob> {
    return (this.queue ??= new Queue<PosSyncJob>(POS_SYNC_QUEUE, {
      connection: bullConnection(),
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
      },
    }));
  }

  onModuleInit() {
    if (!this.enabled) return;
    this.worker = new Worker<PosSyncJob>(
      POS_SYNC_QUEUE,
      (job) => this.run(job.name as PosSyncJobName, job.data.integrationId),
      // One job at a time: a scheduled and a requested import of the same venue must not interleave
      { connection: bullConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, e) =>
      this.logger.warn(
        `${job?.name} of integration ${job?.data.integrationId} failed: ${errorMessage(e)}`,
      ),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Runs one job now (the worker, and the request itself when queues are off). */
  async run(name: PosSyncJobName, integrationId: string): Promise<void> {
    if (name === 'stop-list') return this.stopList.refresh(integrationId);
    const row = await this.prisma.pos_integration.findUnique({
      where: { id: integrationId },
    });
    // Removed or not enabled yet: a leftover scheduled job does nothing
    if (!row || row.status === 'draft') return;
    await this.menu.import(row);
    await this.stopList.refresh(integrationId);
  }

  async enqueue(name: PosSyncJobName, integrationId: string): Promise<void> {
    if (!this.enabled) return this.run(name, integrationId);
    // A pending menu import absorbs repeated requests. A stop list job is never collapsed: a signal
    // arriving while a refresh runs must refresh again
    await this.q.add(
      name,
      { integrationId },
      name === 'menu' ? { jobId: `pos-menu-now-${integrationId}` } : {},
    );
  }

  async schedule(integrationId: string): Promise<void> {
    if (!this.enabled) return;
    await this.q.upsertJobScheduler(
      schedulerId(integrationId),
      { every: MENU_IMPORT_EVERY_MS },
      { name: 'menu', data: { integrationId } },
    );
  }

  async unschedule(integrationId: string): Promise<void> {
    if (!this.enabled) return;
    await this.q.removeJobScheduler(schedulerId(integrationId));
  }
}
