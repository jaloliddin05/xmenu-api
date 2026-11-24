import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import type { StaffPushEvent } from './staff-push-texts';
import { WEB_PUSH_SENDER, type PushSender } from './web-push.sender';

/** One notification to the staff of a venue. Holds no guest data: only the order id and the final texts. */
export interface StaffPushJob {
  organizationId: string;
  orderId: string;
  event: StaffPushEvent;
  title: string;
  body: string;
  /** A retry: only these subscriptions failed temporarily last time (the others got the message) */
  pending?: string[];
}

/** The push service keeps a message this long; a later one about the order replaces it (topic). */
export const STAFF_PUSH_TTL_SECONDS = 300;

/** Topic of the order's messages: base64url, at most 32 characters (a UUID without dashes). */
export const orderTopic = (orderId: string) => orderId.replace(/-/g, '');

/** What the service worker of the dashboard gets (docs/API.md, "Web push сотрудникам"). */
export function staffPushPayload(job: StaffPushJob): string {
  return JSON.stringify({
    title: job.title,
    body: job.body,
    tag: `order-${job.orderId}`,
    data: {
      url: `/order?o=${job.orderId}`,
      orderId: job.orderId,
      event: job.event,
    },
  });
}

/** The push service of an endpoint, for the log: the full endpoint is a credential of the browser. */
const endpointHost = (endpoint: string) => {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'invalid endpoint';
  }
};

/**
 * Sends one notification to every subscribed browser of the venue's active owners and operators (operators are
 * not bound to branches: everyone of the venue gets it). 404/410 removes the subscription; any other failure
 * counts in failure_count, and the temporary ones are returned for a retry.
 */
@Injectable()
export class StaffPushDelivery {
  private readonly logger = new Logger('StaffPush');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WEB_PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  /** Ids of the subscriptions worth another attempt. */
  async deliver(job: StaffPushJob): Promise<string[]> {
    const subscriptions = await this.prisma.staff_push_subscription.findMany({
      where: {
        organization_id: job.organizationId,
        ...(job.pending ? { id: { in: job.pending } } : {}),
        user: {
          isActive: true,
          membership: {
            is: {
              organization_id: job.organizationId,
              status: 'active',
              role: { in: ['owner', 'operator'] },
            },
          },
        },
      },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    const payload = staffPushPayload(job);
    const retry: string[] = [];
    for (const sub of subscriptions) {
      const result = await this.sender.send(sub, payload, {
        ttl: STAFF_PUSH_TTL_SECONDS,
        topic: orderTopic(job.orderId),
      });
      if (result.kind === 'sent') {
        await this.prisma.staff_push_subscription.updateMany({
          where: { id: sub.id },
          data: { last_success_at: new Date(), failure_count: 0 },
        });
        continue;
      }
      if (result.kind === 'gone') {
        await this.prisma.staff_push_subscription.deleteMany({
          where: { id: sub.id },
        });
        this.logger.log(
          `Order ${job.orderId}: subscription ${sub.id} gone (${result.status} from ${endpointHost(sub.endpoint)}), removed`,
        );
        continue;
      }
      await this.prisma.staff_push_subscription.updateMany({
        where: { id: sub.id },
        data: { failure_count: { increment: 1 } },
      });
      this.logger.warn(
        `Order ${job.orderId}: push ${job.event} to subscription ${sub.id} failed (${result.status ?? 'network'} from ${endpointHost(sub.endpoint)})`,
      );
      if (result.kind === 'retry') retry.push(sub.id);
    }
    return retry;
  }
}
