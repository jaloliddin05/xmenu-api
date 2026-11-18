import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  LIVE_STATUSES,
  type OrderStatusName,
} from 'src/modules/order/domain/order-state-machine';
import { RestaurantNotifierService } from 'src/modules/order/notifications/restaurant-notifier.service';
import {
  InvalidTransitionError,
  OrderTransitionService,
} from 'src/modules/order/services/order-transition.service';
import { decidePosStatus } from '../domain/pos-status-map';
import { iikoErrorText } from '../iiko/iiko-api.client';
import { POS_PROVIDER } from '../provider/pos-provider';
import type { PosOrderInfo, PosProvider } from '../provider/pos-provider';
import { PosKeyring } from './pos-keyring';
import { PosOrderService } from './pos-order.service';
import { isPosLive } from '../domain/pos-steps';

/** Orders asked about in one deliveries/by_id call */
const POLL_BATCH = 50;

/**
 * iiko statuses move Xmenu orders (docs/IIKO.md, "Путь заказа и статусы"): from the webhook and,
 * when it does not come, from a poll of the unfinished orders every 5 minutes. One handler for both;
 * an event is taken into account once (the last iiko status is swapped in one conditional update).
 */
@Injectable()
export class PosOrderStatusService {
  private readonly logger = new Logger('PosOrderStatus');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(POS_PROVIDER) private readonly provider: PosProvider,
    private readonly keyring: PosKeyring,
    private readonly orders: PosOrderService,
    private readonly transitions: OrderTransitionService,
    private readonly restaurant: RestaurantNotifierService,
  ) {}

  /** What iiko reported about one order of this integration. */
  async apply(integrationId: string, info: PosOrderInfo): Promise<void> {
    const row = await this.prisma.pos_order.findUnique({
      where: { order_id: info.id },
      include: {
        order: { select: { status: true, fulfillment: true } },
        integration: {
          select: {
            id: true,
            courier_mode: true,
            api_key_encrypted: true,
            external_org_id: true,
          },
        },
      },
    });
    if (!row || row.integration_id !== integrationId) return;
    if (row.state === 'sending') {
      await this.orders.creationReported(info);
      if (info.creation !== 'success') return;
    } else if (row.state !== 'sent') return;
    if (info.courierName && info.courierName !== row.courier_name)
      await this.prisma.pos_order.update({
        where: { id: row.id },
        data: { courier_name: info.courierName },
      });
    if (!info.status) return;

    const order = {
      status: row.order.status as OrderStatusName,
      fulfillment: row.order.fulfillment,
    };
    const decision = decidePosStatus({
      status: info.status,
      previous: row.pos_status,
      order,
      courierMode: row.integration.courier_mode,
    });
    if (decision.repeat) return;
    const note = `iiko:${info.status}`;

    if (decision.alert === 'conflict') {
      // The status goes back or contradicts the order: journal and alert, the last status seen stays
      await this.journal(info.id, order.status, `${note}:conflict`);
      await this.alert(info.id, { kind: 'conflict', posStatus: info.status });
      return;
    }
    const swapped = await this.prisma.pos_order.updateMany({
      where: { id: row.id, pos_status: row.pos_status },
      data: { pos_status: info.status },
    });
    if (!swapped.count) return; // another delivery of the same news got here first

    if (decision.confirm) await this.orders.confirm(row);
    if (decision.cancel) {
      await this.move(info.id, 'cancelled', note);
      await this.alert(info.id, { kind: 'cancelled' });
      return;
    }
    if (!decision.steps.length) {
      await this.journal(info.id, order.status, note);
      return;
    }
    for (const to of decision.steps)
      if (!(await this.move(info.id, to, note))) {
        await this.alert(info.id, { kind: 'conflict', posStatus: info.status });
        return;
      }
  }

  private async move(
    orderId: string,
    to: OrderStatusName,
    note: string,
  ): Promise<boolean> {
    try {
      await this.transitions.transition({
        orderId,
        to,
        actor: 'pos',
        note,
        ...(to === 'cancelled' ? { reason: 'pos_cancelled' } : {}),
      });
      return true;
    } catch (e) {
      if (!(e instanceof InvalidTransitionError)) throw e;
      await this.journal(orderId, e.from, `${note}:conflict`);
      return false;
    }
  }

  private journal(orderId: string, status: OrderStatusName, note: string) {
    return this.transitions.recordInTx(this.prisma, {
      orderId,
      status,
      actor: 'pos',
      note,
    });
  }

  private async alert(
    orderId: string,
    alert: Parameters<RestaurantNotifierService['alertPos']>[1],
  ) {
    try {
      await this.restaurant.alertPos(orderId, alert);
    } catch (e) {
      this.logger.warn(
        `alert ${alert.kind} of order ${orderId} not sent: ${iikoErrorText(e)}`,
      );
    }
  }

  /** The statuses of unfinished orders of one integration, for a webhook that did not come. */
  async poll(integrationId: string): Promise<void> {
    const integration = await this.prisma.pos_integration.findUnique({
      where: { id: integrationId },
      select: {
        id: true,
        status: true,
        api_key_encrypted: true,
        external_org_id: true,
      },
    });
    if (!integration?.external_org_id || !isPosLive(integration.status)) return;
    const rows = await this.prisma.pos_order.findMany({
      where: {
        integration_id: integrationId,
        state: { in: ['sending', 'sent'] },
        order: { status: { in: [...LIVE_STATUSES] } },
      },
      select: { order_id: true },
    });
    const cred = this.keyring.credentials(integration);
    for (let i = 0; i < rows.length; i += POLL_BATCH) {
      const ids = rows.slice(i, i + POLL_BATCH).map((r) => r.order_id);
      let infos: PosOrderInfo[];
      try {
        infos = await this.provider.orders(
          cred,
          integration.external_org_id,
          ids,
        );
      } catch (e) {
        this.logger.warn(
          `poll of integration ${integrationId} failed: ${iikoErrorText(e)}`,
        );
        return;
      }
      for (const info of infos) await this.apply(integrationId, info);
    }
  }
}
