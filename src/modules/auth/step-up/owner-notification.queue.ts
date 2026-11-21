import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { bullConnection } from 'src/infra/redis/bull-connection';
import { errorMessage } from 'src/infra/helper/error-text';
import { maskPhone } from 'src/infra/helper/auth/customer-validators';
import { SMS_PROVIDER } from 'src/modules/sms/providers/sms-provider.interface';
import type { SmsProvider } from 'src/modules/sms/providers/sms-provider.interface';

export const OWNER_NOTIFICATION_QUEUE_NAME = 'owner-notification';
export const OWNER_NOTIFICATION_QUEUE = Symbol('OWNER_NOTIFICATION_QUEUE');

/** One SMS to an owner; the text is final, the phone is E.164. */
export interface OwnerNotificationJob {
  phone: string;
  text: string;
}

export interface OwnerNotificationQueue {
  /** Never throws: a failure is logged and the action that asked for the SMS stays done. */
  enqueue(job: OwnerNotificationJob): Promise<void>;
}

/** Sends one owner SMS; the worker below and the no-queue fallback both go through it. */
@Injectable()
export class OwnerNotificationSender {
  constructor(@Inject(SMS_PROVIDER) private readonly sms: SmsProvider) {}

  send(job: OwnerNotificationJob): Promise<void> {
    return this.sms.send(job.phone, job.text);
  }
}

/**
 * Owner security SMS wait in BullMQ (3 attempts) so the request does not wait for the SMS provider. With
 * ORDER_QUEUES=off (local runs without workers) the SMS is sent at once, without waiting and without retries.
 */
@Injectable()
export class BullOwnerNotificationQueue
  implements OwnerNotificationQueue, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('OwnerNotification');
  private readonly enabled = process.env.ORDER_QUEUES !== 'off';
  private queue?: Queue<OwnerNotificationJob>;
  private worker?: Worker<OwnerNotificationJob>;

  constructor(private readonly sender: OwnerNotificationSender) {}

  onModuleInit() {
    if (!this.enabled) return;
    this.worker = new Worker<OwnerNotificationJob>(
      OWNER_NOTIFICATION_QUEUE_NAME,
      (job) => this.sender.send(job.data),
      { connection: bullConnection(), concurrency: 2 },
    );
    this.worker.on(
      'failed',
      (job: Job<OwnerNotificationJob> | undefined, err: Error) =>
        this.logger.warn(
          `owner SMS to ${maskPhone(job?.data?.phone)} not sent: ${errorMessage(err)}`,
        ),
    );
  }

  async enqueue(job: OwnerNotificationJob): Promise<void> {
    if (!this.enabled) {
      void this.sender
        .send(job)
        .catch((err) =>
          this.logger.warn(
            `owner SMS to ${maskPhone(job.phone)} not sent: ${errorMessage(err)}`,
          ),
        );
      return;
    }
    try {
      this.queue ??= new Queue<OwnerNotificationJob>(
        OWNER_NOTIFICATION_QUEUE_NAME,
        {
          connection: bullConnection(),
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            // The job holds the owner's phone: failed ones are kept for a day only
            removeOnFail: { age: 24 * 3600 },
          },
        },
      );
      await this.queue.add('sms', job);
    } catch (err) {
      this.logger.warn(
        `owner SMS to ${maskPhone(job.phone)} not queued: ${errorMessage(err)}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
