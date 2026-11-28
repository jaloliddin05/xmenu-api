import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { bullConnection } from 'src/infra/redis/bull-connection';
import { errorMessage } from 'src/infra/helper/error-text';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { PosMenuImportService } from './pos-menu-import.service';
import { PosOrderQueue } from './pos-order.queue';
import { PosStopListService } from './pos-stop-list.service';
import { isPosLive } from '../domain/pos-steps';
import { LiveEventBus } from 'src/modules/live/live-event-bus';

export const POS_SYNC_QUEUE = 'pos-sync';
/** Menu import interval by default, minutes (docs/IIKO.md: no webhook announces a changed menu) */
export const MENU_IMPORT_DEFAULT_MINUTES = 30;
const MENU_IMPORT_MIN_MINUTES = 5;
const MENU_IMPORT_MAX_MINUTES = 24 * 60;

/** IIKO_MENU_IMPORT_MINUTES (env-schema.ts) in ms, kept within 5 minutes .. a day. */
export function menuImportEveryMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = Number.parseInt(env.IIKO_MENU_IMPORT_MINUTES ?? '', 10);
  const minutes = Number.isFinite(raw)
    ? Math.min(MENU_IMPORT_MAX_MINUTES, Math.max(MENU_IMPORT_MIN_MINUTES, raw))
    : MENU_IMPORT_DEFAULT_MINUTES;
  return minutes * 60_000;
}

export type PosSyncJobName = 'menu' | 'stop-list';
export interface PosSyncJob {
  integrationId: string;
}

const schedulerId = (integrationId: string) => `pos-menu-${integrationId}`;

/**
 * Menu imports and stop list refreshes run here (one pending menu import per integration). Every
 * active integration has a scheduler that imports its menu every IIKO_MENU_IMPORT_MINUTES (30 by
 * default; a changed interval applies after a restart, rescheduleAll). With ORDER_QUEUES=off (local run without Redis) the work runs in the calling request.
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
    private readonly orders: PosOrderQueue,
    @Optional() private readonly live?: LiveEventBus,
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
    // A changed IIKO_MENU_IMPORT_MINUTES applies after a restart: the schedulers are set again
    void this.rescheduleAll().catch((e: unknown) =>
      this.logger.warn(
        `menu import schedulers not updated: ${errorMessage(e)}`,
      ),
    );
  }

  /** The menu import scheduler of every working integration, with the current interval. */
  async rescheduleAll(): Promise<void> {
    const live = await this.prisma.pos_integration.findMany({
      where: { status: { in: ['active', 'needs_reconnect'] } },
      select: { id: true },
    });
    for (const { id } of live)
      await this.q.upsertJobScheduler(
        schedulerId(id),
        { every: menuImportEveryMs() },
        { name: 'menu', data: { integrationId: id } },
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
    if (!row || !isPosLive(row.status)) return;
    try {
      await this.menu.import(row);
      await this.stopList.refresh(integrationId);
    } finally {
      // The iiko screen and the menu show the result (or the import error) when it is there, without a timer
      await this.live?.orgChanged(row.organization_id, ['pos', 'menu']);
    }
  }

  async enqueue(name: PosSyncJobName, integrationId: string): Promise<void> {
    if (!this.enabled) return this.run(name, integrationId);
    // A pending menu import absorbs repeated requests. A stop list job is never collapsed: a signal
    // arriving while a refresh runs must refresh again
    await this.q.add(
      name,
      { integrationId },
      // Fixed id so that requests collapse; a job that used up its attempts is dropped, or it would keep the id
      // taken and every later request of the owner would be ignored
      name === 'menu'
        ? { jobId: `pos-menu-now-${integrationId}`, removeOnFail: true }
        : {},
    );
  }

  /** The menu import every IIKO_MENU_IMPORT_MINUTES and the poll of unfinished orders (pos-order.queue.ts). */
  async schedule(integrationId: string): Promise<void> {
    if (!this.enabled) return;
    await this.q.upsertJobScheduler(
      schedulerId(integrationId),
      { every: menuImportEveryMs() },
      { name: 'menu', data: { integrationId } },
    );
    await this.orders.schedulePoll(integrationId);
  }

  async unschedule(integrationId: string): Promise<void> {
    if (!this.enabled) return;
    await this.q.removeJobScheduler(schedulerId(integrationId));
    await this.orders.unschedulePoll(integrationId);
  }
}
