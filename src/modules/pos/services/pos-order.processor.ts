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
  OrderQueueService,
  POS_ORDER_QUEUE,
  PosOrderJob,
  PosOrderJobName,
} from 'src/modules/order/queue/order-queue.service';
import type { PosOrderInfo } from '../provider/pos-provider';
import { PosOrderStatusService } from './pos-order-status.service';
import { PosOrderService } from './pos-order.service';

/** Worker of the pos-orders queue (order-queue.service.ts): sending, checking, statuses. */
@Injectable()
export class PosOrderProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PosOrderQueue');
  private worker?: Worker<PosOrderJob>;

  constructor(
    private readonly orders: PosOrderService,
    private readonly statuses: PosOrderStatusService,
    private readonly queues: OrderQueueService,
  ) {}

  onModuleInit() {
    if (!this.queues.enabled) return;
    this.worker = new Worker<PosOrderJob>(
      POS_ORDER_QUEUE,
      (job: Job<PosOrderJob>) => this.process(job),
      { connection: bullConnection(), concurrency: 5 },
    );
    this.worker.on('failed', (job, e) =>
      this.logger.warn(
        `${job?.name} (${job?.data.orderId ?? job?.data.integrationId ?? '?'}) failed: ${errorMessage(e)}`,
      ),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  process(job: Pick<Job<PosOrderJob>, 'name' | 'data'>): Promise<void> {
    const { orderId, integrationId, correlationId, polls } = job.data;
    switch (job.name as PosOrderJobName) {
      case 'push':
        return this.orders.push(orderId!);
      case 'check':
        return this.orders.check(orderId!, correlationId!, polls ?? 0);
      case 'delivered':
        return this.orders.delivered(orderId!);
      case 'poll':
        return this.statuses.poll(integrationId!);
      case 'event':
        return this.statuses.apply(
          integrationId!,
          job.data.event as PosOrderInfo,
        );
      default:
        return Promise.resolve();
    }
  }
}
