import { Injectable } from '@nestjs/common';
import {
  OrderQueueService,
  PosOrderJob,
} from 'src/modules/order/queue/order-queue.service';

/** How often the statuses of unfinished orders are asked when no webhook came (docs/IIKO.md) */
export const POS_POLL_EVERY_MS = 5 * 60_000;
/** Pause between two questions about one command (deliveries/create) */
export const POS_CHECK_EVERY_MS = 3_000;

const pollSchedulerId = (integrationId: string) => `pos-poll-${integrationId}`;

/**
 * Follow-up jobs of the pos-orders queue (the queue itself belongs to order-core, which adds the
 * first job of an accepted order). Without queues (ORDER_QUEUES=off) nothing is added.
 */
@Injectable()
export class PosOrderQueue {
  constructor(private readonly queues: OrderQueueService) {}

  get enabled(): boolean {
    return this.queues.enabled;
  }

  private async add(name: string, data: PosOrderJob, jobId: string, delay = 0) {
    if (!this.enabled) return;
    await this.queues.posOrderQueue.add(name, data, { jobId, delay });
  }

  /** Attempt `attempt + 1` of sending the order (`round` keeps an operator's retry apart). */
  push(orderId: string, attempt: number, delay: number, round = '') {
    return this.add(
      'push',
      { orderId },
      `pos-push-${orderId}${round ? `-${round}` : ''}-${attempt}`,
      delay,
    );
  }

  check(orderId: string, correlationId: string, polls: number) {
    return this.add(
      'check',
      { orderId, correlationId, polls },
      `pos-check-${orderId}-${correlationId}-${polls}`,
      POS_CHECK_EVERY_MS,
    );
  }

  async schedulePoll(integrationId: string): Promise<void> {
    if (!this.enabled) return;
    await this.queues.posOrderQueue.upsertJobScheduler(
      pollSchedulerId(integrationId),
      { every: POS_POLL_EVERY_MS },
      { name: 'poll', data: { integrationId } },
    );
  }

  async unschedulePoll(integrationId: string): Promise<void> {
    if (!this.enabled) return;
    await this.queues.posOrderQueue.removeJobScheduler(
      pollSchedulerId(integrationId),
    );
  }
}
