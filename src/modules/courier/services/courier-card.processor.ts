import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { errorMessage } from 'src/infra/helper/error-text';
import { bullConnection } from 'src/infra/redis/bull-connection';
import {
  COURIER_CARD_QUEUE,
  CourierCardJob,
  OrderQueueService,
} from 'src/modules/order/queue/order-queue.service';
import { CourierCardService } from './courier-card.service';

/** Worker of the courier-cards queue: rebuilds one order card in one courier's chat. */
@Injectable()
export class CourierCardProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('CourierCardQueue');
  private worker?: Worker<CourierCardJob>;

  constructor(
    private readonly cards: CourierCardService,
    private readonly queues: OrderQueueService,
  ) {}

  onModuleInit() {
    if (!this.queues.enabled) return;
    this.worker = new Worker<CourierCardJob>(
      COURIER_CARD_QUEUE,
      (job: Job<CourierCardJob>) =>
        this.cards.refresh(job.data.orderId, job.data.courierId),
      { connection: bullConnection() },
    );
    this.worker.on('failed', (job, err) => {
      const made = job?.attemptsMade ?? 0;
      const attempts = job?.opts.attempts ?? 1;
      const what = `order ${job?.data.orderId ?? '?'}, attempt ${made}/${attempts}`;
      if (made >= attempts)
        this.logger.error(`Card not delivered: ${what}: ${errorMessage(err)}`);
      else this.logger.warn(`Card will retry: ${what}: ${errorMessage(err)}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
