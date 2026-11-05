import type {
  TelegramUpdateJob,
  TelegramUpdateQueue,
} from './telegram-update.queue';

/**
 * In-process stand-in for the BullMQ queue: runs each job on a later tick, the way a worker picks it
 * up after the webhook has answered. `fail` makes enqueue throw (Redis down).
 */
export class InProcessTelegramUpdateQueue implements TelegramUpdateQueue {
  readonly jobs: TelegramUpdateJob[] = [];
  fail: Error | null = null;
  private readonly running: Promise<unknown>[] = [];

  constructor(
    private readonly run: (job: TelegramUpdateJob) => Promise<unknown>,
  ) {}

  async enqueue(job: TelegramUpdateJob): Promise<void> {
    if (this.fail) throw this.fail;
    this.jobs.push(job);
    this.running.push(
      new Promise((resolve) => setImmediate(resolve)).then(() => this.run(job)),
    );
  }

  /** Waits until every queued job has finished. */
  async idle(): Promise<void> {
    await Promise.allSettled(this.running);
  }
}
