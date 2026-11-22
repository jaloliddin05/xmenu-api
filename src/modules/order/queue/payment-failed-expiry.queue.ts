import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { bullConnection } from 'src/infra/redis/bull-connection';
import { errorMessage } from 'src/infra/helper/error-text';
import { PaymentFailedExpiryService } from './payment-failed-expiry.service';

export const PAYMENT_FAILED_EXPIRY_QUEUE = 'payment-failed-expiry';
export const PAYMENT_FAILED_EXPIRY_SCHEDULER_ID =
  'payment-failed-expiry-hourly';
/** At the start of every hour: with a TTL in hours an hour of delay does not matter */
export const PAYMENT_FAILED_EXPIRY_PATTERN = '0 * * * *';

/**
 * An hourly scan rather than a delayed job per order: an order gets into payment_failed by several paths
 * (the payment-expiry timer, a provider webhook), a per-order job is lost with Redis and keeps the TTL it was
 * created with, while the scan is idempotent and catches up by itself. The scheduler is set again on every
 * start (upsert), so several processes never double it. With ORDER_QUEUES=off nothing is scheduled.
 */
@Injectable()
export class PaymentFailedExpiryQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PaymentFailedExpiry');
  readonly enabled = process.env.ORDER_QUEUES !== 'off';
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly expiry: PaymentFailedExpiryService) {}

  private get q(): Queue {
    return (this.queue ??= new Queue(PAYMENT_FAILED_EXPIRY_QUEUE, {
      connection: bullConnection(),
      defaultJobOptions: { removeOnComplete: true, removeOnFail: 30 },
    }));
  }

  onModuleInit() {
    if (!this.enabled) return;
    this.worker = new Worker(
      PAYMENT_FAILED_EXPIRY_QUEUE,
      async () => {
        await this.expiry.run();
      },
      { connection: bullConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (_job, e) =>
      this.logger.warn(`expiry failed: ${errorMessage(e)}`),
    );
    void this.schedule().catch((e: unknown) =>
      this.logger.warn(`expiry not scheduled: ${errorMessage(e)}`),
    );
  }

  async schedule(): Promise<void> {
    await this.q.upsertJobScheduler(
      PAYMENT_FAILED_EXPIRY_SCHEDULER_ID,
      { pattern: PAYMENT_FAILED_EXPIRY_PATTERN },
      { name: 'run', data: {} },
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
