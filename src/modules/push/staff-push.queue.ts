import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { bullConnection } from 'src/infra/redis/bull-connection';
import { errorMessage } from 'src/infra/helper/error-text';
import {
  StaffPushDelivery,
  type StaffPushJob,
} from './staff-push-delivery.service';

export const STAFF_PUSH_QUEUE_NAME = 'staff-push';
export const STAFF_PUSH_QUEUE = Symbol('STAFF_PUSH_QUEUE');
export const STAFF_PUSH_ATTEMPTS = 3;

export interface StaffPushQueue {
  /** Never throws: a failure is logged and the order transition that asked for it stays done. */
  enqueue(job: StaffPushJob, jobId: string): Promise<void>;
}

/** A job failed for some subscriptions only: BullMQ retries it for them. */
class StaffPushRetry extends Error {}

/**
 * Staff notifications wait in BullMQ so an order transition never waits for Google, Mozilla or Apple. A retry
 * sends only to the subscriptions that failed temporarily (job.data.pending), never twice to the others. With
 * ORDER_QUEUES=off it is sent at once, without retries.
 */
@Injectable()
export class BullStaffPushQueue
  implements StaffPushQueue, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('StaffPush');
  private readonly enabled = process.env.ORDER_QUEUES !== 'off';
  private queue?: Queue<StaffPushJob>;
  private worker?: Worker<StaffPushJob>;

  constructor(private readonly delivery: StaffPushDelivery) {}

  onModuleInit() {
    if (!this.enabled) return;
    this.worker = new Worker<StaffPushJob>(
      STAFF_PUSH_QUEUE_NAME,
      (job) => this.process(job),
      { connection: bullConnection(), concurrency: 5 },
    );
    this.worker.on(
      'failed',
      (job: Job<StaffPushJob> | undefined, err: Error) => {
        if (!(err instanceof StaffPushRetry))
          this.logger.error(
            `Order ${job?.data?.orderId}: push job failed: ${errorMessage(err)}`,
          );
      },
    );
  }

  async process(job: Job<StaffPushJob>): Promise<void> {
    const retry = await this.delivery.deliver(job.data);
    const attempts = job.opts.attempts ?? STAFF_PUSH_ATTEMPTS;
    if (!retry.length || job.attemptsMade + 1 >= attempts) return;
    await job.updateData({ ...job.data, pending: retry });
    throw new StaffPushRetry();
  }

  async enqueue(job: StaffPushJob, jobId: string): Promise<void> {
    if (!this.enabled) {
      void this.delivery
        .deliver(job)
        .catch((err) =>
          this.logger.error(
            `Order ${job.orderId}: push not sent: ${errorMessage(err)}`,
          ),
        );
      return;
    }
    try {
      this.queue ??= new Queue<StaffPushJob>(STAFF_PUSH_QUEUE_NAME, {
        connection: bullConnection(),
        defaultJobOptions: {
          attempts: STAFF_PUSH_ATTEMPTS,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      });
      await this.queue.add('push', job, { jobId });
    } catch (err) {
      this.logger.error(
        `Order ${job.orderId}: push not queued: ${errorMessage(err)}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
