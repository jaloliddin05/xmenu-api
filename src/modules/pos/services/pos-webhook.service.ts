import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from 'src/infra/redis/redis.module';
import { AppException } from 'src/infra/errors/app-exception';
import { errorMessage } from 'src/infra/helper/error-text';
import { webhookSecretMatches } from 'src/infra/http/webhook-secret';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { POS_PROVIDER } from '../provider/pos-provider';
import type { PosProvider, PosWebhookEvent } from '../provider/pos-provider';
import { PosOrderStatusService } from './pos-order-status.service';
import { PosOrderQueue } from './pos-order.queue';
import { PosSyncQueue } from './pos-sync.queue';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How long a handled event is remembered (iiko repeats an unanswered call) */
const EVENT_TTL_SECONDS = 24 * 3600;

const eventKey = (integrationId: string, key: string) =>
  `pos:evt:${integrationId}:${key}`;

/**
 * POS webhook calls (docs/IIKO.md, "Вебхуки"): the address carries the integration id; the
 * Authorization header must match the secret given to iiko (sha256 in the database, compared in
 * constant time); an unknown id and a wrong secret answer the same 401. The body is an array of
 * events, each counted once (Redis SET NX). The answer comes as soon as the events are recorded and
 * queued (iiko blocks slow webhooks, audit W15-04): StopListUpdate queues a stop list refresh, a
 * delivery order event queues its handling (PosOrderStatusService: status, confirm, alerts) with
 * retries. Without queues (ORDER_QUEUES=off) the order event is handled in the request.
 */
@Injectable()
export class PosWebhookService {
  private readonly logger = new Logger('PosWebhook');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(POS_PROVIDER) private readonly provider: PosProvider,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly sync: PosSyncQueue,
    private readonly statuses: PosOrderStatusService,
    private readonly orderQueue: PosOrderQueue,
  ) {}

  async receive(
    integrationId: string,
    authorization: string | undefined,
    body: unknown,
  ): Promise<void> {
    const row = UUID_RE.test(integrationId)
      ? await this.prisma.pos_integration.findUnique({
          where: { id: integrationId },
          select: {
            id: true,
            status: true,
            external_org_id: true,
            webhook_secret_hash: true,
          },
        })
      : null;
    // iiko sends the authToken as is; a "Bearer " prefix is tolerated
    const secret = authorization?.replace(/^Bearer\s+/i, '');
    if (
      !row?.webhook_secret_hash ||
      !webhookSecretMatches(secret, row.webhook_secret_hash)
    )
      throw new AppException('unauthorized');

    const events = this.provider.parseWebhook(body);
    for (const event of events) {
      if (event.externalOrgId && event.externalOrgId !== row.external_org_id)
        continue;
      const fresh = await this.redis.set(
        eventKey(row.id, event.key),
        '1',
        'EX',
        EVENT_TTL_SECONDS,
        'NX',
      );
      if (fresh !== 'OK') continue; // a repeat delivery: already handled
      try {
        await this.handle(row.id, event);
      } catch (e) {
        await this.redis
          .del(eventKey(row.id, event.key))
          .catch(() => undefined);
        this.logger.error(
          `event ${event.type} of integration ${row.id} not queued: ${errorMessage(e)}`,
        );
        // iiko calls again; already handled events of the same call are skipped then
        throw new AppException('unavailable');
      }
    }
  }

  private async handle(integrationId: string, event: PosWebhookEvent) {
    switch (event.type) {
      case 'StopListUpdate':
        await this.sync.enqueue('stop-list', integrationId);
        return;
      case 'DeliveryOrderUpdate':
      case 'DeliveryOrderError':
        if (!event.order) return;
        if (await this.orderQueue.event(integrationId, event.order, event.key))
          return;
        await this.statuses.apply(integrationId, event.order);
        return;
      default:
        return;
    }
  }
}
