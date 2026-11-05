import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { bullConnection } from 'src/infra/redis/bull-connection';
import type { TelegramUpdate } from './telegram-verification.service';

export const TELEGRAM_UPDATE_QUEUE_NAME = 'telegram-update';
export const TELEGRAM_UPDATE_QUEUE = Symbol('TELEGRAM_UPDATE_QUEUE');

/** Only the bot's key travels with the update: the worker loads and decrypts the token itself. */
export interface TelegramUpdateJob {
  botKey: string;
  update: TelegramUpdate;
}

export interface TelegramUpdateQueue {
  enqueue(job: TelegramUpdateJob): Promise<void>;
}

/** BullMQ job id: one job per delivered update (BullMQ ids cannot contain ':'). */
export function telegramUpdateJobId(
  job: TelegramUpdateJob,
): string | undefined {
  return typeof job.update?.update_id === 'number'
    ? `tg-update-${job.botKey}-${job.update.update_id}`
    : undefined;
}

/**
 * Venue bot updates wait here so the webhook can answer Telegram at once (W6-06). Failed jobs keep
 * the update (it may hold a shared phone number) for a day only.
 */
@Injectable()
export class BullTelegramUpdateQueue
  implements TelegramUpdateQueue, OnModuleDestroy
{
  private readonly queue = new Queue<TelegramUpdateJob>(
    TELEGRAM_UPDATE_QUEUE_NAME,
    {
      connection: bullConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: { age: 24 * 3600 },
      },
    },
  );

  async enqueue(job: TelegramUpdateJob): Promise<void> {
    await this.queue.add('update', job, { jobId: telegramUpdateJobId(job) });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
