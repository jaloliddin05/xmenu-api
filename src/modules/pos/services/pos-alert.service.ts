import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from 'src/infra/redis/redis.module';
import { errorMessage } from 'src/infra/helper/error-text';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { OpsNotifierService } from 'src/modules/order/notifications/ops-notifier.service';
import { RestaurantNotifierService } from 'src/modules/order/notifications/restaurant-notifier.service';

/** What the owner is warned about (pos_integration.alert; the POS screen shows a banner). */
export type PosIntegrationAlert = 'menu_import_failed' | 'key_revoked';

/** Key rejections of different venues within this window point at the platform's application */
export const KEY_REJECTED_WINDOW_SECONDS = 600;
const KEY_REJECTED = 'pos:key-rejected';
/** One ops message an hour about the platform's iiko application */
const OPS_PLATFORM = 'ops:pos-platform';
const OPS_EVERY_SECONDS = 3600;

/**
 * Alerts of the iiko integration (docs/IIKO.md, "Ошибки и сбои"). The owner's: a menu import that
 * failed and a key iiko rejected; the field on the integration is set once per episode, and only
 * that change sends one message to every branch chat. The platform's: iiko rejecting the Xmenu
 * application (IIKO_APP_ID / IIKO_CLIENT_SECRET) goes to the log and the ops chat, and no venue is
 * asked to reconnect.
 */
@Injectable()
export class PosAlertService {
  private readonly logger = new Logger('PosAlert');

  constructor(
    private readonly prisma: PrismaService,
    private readonly restaurant: RestaurantNotifierService,
    private readonly ops: OpsNotifierService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async raise(
    integration: { id: string; organization_id: string },
    alert: PosIntegrationAlert,
  ): Promise<void> {
    const marked = await this.prisma.pos_integration.updateMany({
      where: {
        id: integration.id,
        OR: [{ alert: null }, { alert: { not: alert } }],
      },
      data: { alert, alert_at: new Date() },
    });
    if (!marked.count) return;
    try {
      if (alert === 'key_revoked')
        await this.restaurant.alertPosReconnect(integration.organization_id);
      else
        await this.restaurant.alertPosMenuImport(integration.organization_id);
    } catch (e) {
      this.logger.warn(
        `alert ${alert} of integration ${integration.id} not sent: ${errorMessage(e)}`,
      );
    }
  }

  /** The episode is over (the menu imported, a new key entered). */
  async clear(integrationId: string, alert: PosIntegrationAlert) {
    await this.prisma.pos_integration.updateMany({
      where: { id: integrationId, alert },
      data: { alert: null, alert_at: null },
    });
  }

  /**
   * iiko rejected the key of a venue on the token call. True when keys of two or more venues were
   * rejected within 10 minutes: then the platform's application is the likely cause, venues marked
   * "needs reconnect" within the window go back to active, and the ops chat is told.
   */
  async keyRejected(integrationId: string): Promise<boolean> {
    const now = Date.now();
    await this.redis.hset(KEY_REJECTED, integrationId, String(now));
    await this.redis.expire(KEY_REJECTED, KEY_REJECTED_WINDOW_SECONDS);
    const since = now - KEY_REJECTED_WINDOW_SECONDS * 1000;
    const ids = Object.entries(await this.redis.hgetall(KEY_REJECTED))
      .filter(([, at]) => Number(at) >= since)
      .map(([id]) => id);
    if (ids.length < 2) return false;
    await this.prisma.pos_integration.updateMany({
      where: { id: { in: ids }, status: 'needs_reconnect' },
      data: { status: 'active', alert: null, alert_at: null },
    });
    await this.platform(
      `iiko rejected the keys of ${ids.length} venues within ${KEY_REJECTED_WINDOW_SECONDS / 60} minutes: check the iiko application credentials of the platform`,
    );
    return true;
  }

  /** iiko rejects the platform's application: the log and, once an hour, the ops chat. */
  async platform(text: string): Promise<void> {
    this.logger.error(text);
    try {
      const first = await this.redis.set(
        OPS_PLATFORM,
        '1',
        'EX',
        OPS_EVERY_SECONDS,
        'NX',
      );
      if (first === 'OK') await this.ops.alert(`iiko: ${text}`);
    } catch (e) {
      this.logger.warn(`ops alert not sent: ${errorMessage(e)}`);
    }
  }
}
