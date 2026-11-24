import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { errorMessage } from 'src/infra/helper/error-text';
import { REDIS } from 'src/infra/redis/redis.module';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { staffPushText, type StaffPushEvent } from './staff-push-texts';
import { STAFF_PUSH_QUEUE, type StaffPushQueue } from './staff-push.queue';
import { WEB_PUSH_SENDER, type PushSender } from './web-push.sender';

/** A repeated effect of the same transition sends nothing for this long. */
const DEDUPE_TTL_SECONDS = 24 * 3600;

/** The status an order is in while its notification still makes sense. */
const EVENT_STATUS: Record<StaffPushEvent, string> = {
  new_order: 'pending_acceptance',
  at_door: 'problem_at_door',
  cannot_deliver: 'ready',
};

/**
 * Web push to the venue staff about an order (docs/API.md, "Web push сотрудникам"): a new order, the courier at
 * the door, the courier cannot deliver. Called from the order effects after the commit; never throws and never
 * delays the transition. One event of one order state (its `version`) is sent once (SET NX in Redis).
 */
@Injectable()
export class StaffPushService {
  private readonly logger = new Logger('StaffPush');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Pick<Redis, 'set'>,
    @Inject(STAFF_PUSH_QUEUE) private readonly queue: StaffPushQueue,
    @Inject(WEB_PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  /**
   * `version`: the order version the transition produced; it tells a new episode (the courier at the door again
   * after another trip) from a repeated effect of the same transition.
   */
  async notify(
    orderId: string,
    event: StaffPushEvent,
    version: number,
  ): Promise<void> {
    if (!this.sender.publicKey) return; // push is off on this platform
    try {
      const order = await this.prisma.customer_order.findUnique({
        where: { id: orderId },
        select: {
          organization_id: true,
          number: true,
          status: true,
          fulfillment: true,
          total: true,
          door_problem: true,
          items: { select: { quantity: true } },
        },
      });
      // Already moved on (accepted, picked up again): the notification would only mislead
      if (!order || order.status !== EVENT_STATUS[event]) return;
      const episode = `${orderId}-${event}-${version}`;
      const fresh = await this.redis.set(
        `staffpush:${episode}`,
        '1',
        'EX',
        DEDUPE_TTL_SECONDS,
        'NX',
      );
      if (fresh !== 'OK') return;
      const text = staffPushText(event, {
        number: order.number,
        fulfillment: order.fulfillment,
        itemsCount: order.items.reduce((n, i) => n + i.quantity, 0),
        total: order.total,
        doorProblem: order.door_problem,
      });
      await this.queue.enqueue(
        { organizationId: order.organization_id, orderId, event, ...text },
        `staffpush-${episode}`,
      );
    } catch (e) {
      this.logger.error(
        `Order ${orderId}: push ${event} not queued: ${errorMessage(e)}`,
      );
    }
  }
}
