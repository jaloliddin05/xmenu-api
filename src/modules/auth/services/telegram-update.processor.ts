import { Job, Worker } from 'bullmq';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { bullConnection } from 'src/infra/redis/bull-connection';
import { errorMessage } from 'src/infra/helper/error-text';
import { TelegramBotService } from 'src/modules/telegram/telegram-bot.service';
import { TELEGRAM_UPDATE_QUEUE_NAME } from './telegram-update.queue';
import type { TelegramUpdateJob } from './telegram-update.queue';
import { TelegramVerificationService } from './telegram-verification.service';

export interface TelegramUpdateDeps {
  bots: Pick<TelegramBotService, 'byKey'>;
  verification: Pick<TelegramVerificationService, 'handleUpdate'>;
}

/**
 * One queued update. A bot disconnected (or disabled) since the webhook call is skipped. Errors
 * propagate so BullMQ retries; Telegram failures are already absorbed inside handleUpdate, so a
 * retry means Redis or the database failed.
 */
export async function processTelegramUpdate(
  deps: TelegramUpdateDeps,
  job: TelegramUpdateJob,
): Promise<'done' | 'skipped'> {
  const bot = await deps.bots.byKey(job.botKey);
  if (!bot) return 'skipped';
  await deps.verification.handleUpdate(bot, job.update);
  return 'done';
}

/** Safe to log: ids and the error text only, never the update (phone) or the bot token. */
export function describeTelegramUpdate(
  job: Partial<TelegramUpdateJob> | undefined,
): string {
  return `bot ${job?.botKey ?? '?'} update ${job?.update?.update_id ?? '?'}`;
}

@Injectable()
export class TelegramUpdateProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TelegramUpdate');
  private worker?: Worker<TelegramUpdateJob>;

  constructor(
    private readonly bots: TelegramBotService,
    private readonly verification: TelegramVerificationService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<TelegramUpdateJob>(
      TELEGRAM_UPDATE_QUEUE_NAME,
      async (job: Job<TelegramUpdateJob>) => {
        const result = await processTelegramUpdate(
          { bots: this.bots, verification: this.verification },
          job.data,
        );
        if (result === 'skipped')
          this.logger.log(
            `Skipped (bot not connected): ${describeTelegramUpdate(job.data)}`,
          );
        return result;
      },
      { connection: bullConnection() },
    );
    this.worker.on('failed', (job, err) => {
      const attempts = job?.opts.attempts ?? 1;
      const made = job?.attemptsMade ?? 0;
      const text = `${describeTelegramUpdate(job?.data)}, attempt ${made}/${attempts}: ${errorMessage(err)}`;
      if (made >= attempts) this.logger.error(`Failed: ${text}`);
      else this.logger.warn(`Will retry: ${text}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
