import { errorMessage } from 'src/infra/helper/error-text';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { bullConnection } from 'src/infra/redis/bull-connection';
import {
  CustomerNotifierService,
  GuestNotificationRetry,
  type GuestNotificationJob,
} from '../notifications/customer-notifier.service';
import {
  GUEST_NOTIFICATION_ATTEMPTS,
  GUEST_NOTIFICATION_QUEUE,
} from './order-queue.service';

/**
 * Sends guest notifications queued by CustomerNotifierService. A temporary Telegram failure
 * fails the job so BullMQ retries it; the last attempt gives up and marks the guest unreachable.
 */
@Injectable()
export class GuestNotificationProcessor
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('GuestNotification');
  private worker?: Worker;

  constructor(private readonly notifier: CustomerNotifierService) {}

  onModuleInit() {
    if (process.env.ORDER_QUEUES === 'off') return;
    this.worker = new Worker<GuestNotificationJob>(
      GUEST_NOTIFICATION_QUEUE,
      (job) => this.process(job),
      { connection: bullConnection(), concurrency: 5 },
    );
    this.worker.on(
      'failed',
      (job: Job<GuestNotificationJob> | undefined, err: Error) => {
        // Retries are logged by the notifier; anything else is a bug or the database
        if (!(err instanceof GuestNotificationRetry))
          this.logger.error(
            `Order ${job?.data?.orderId}: notification job failed (${job?.attemptsMade}): ${errorMessage(err)}`,
          );
      },
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  process(job: Job<GuestNotificationJob>): Promise<void> {
    const attempts = job.opts.attempts ?? GUEST_NOTIFICATION_ATTEMPTS;
    return this.notifier.deliver(job.data, job.attemptsMade + 1 >= attempts);
  }
}
