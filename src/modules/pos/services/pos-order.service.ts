import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from 'src/infra/errors/app-exception';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  LIVE_STATUSES,
  type OrderStatusName,
} from 'src/modules/order/domain/order-state-machine';
import type { PosAlert } from 'src/modules/order/notifications/order-messages';
import { RestaurantNotifierService } from 'src/modules/order/notifications/restaurant-notifier.service';
import { OrderTransitionService } from 'src/modules/order/services/order-transition.service';
import { toPosView } from 'src/modules/order/services/order-view';
import { buildPosOrder, type DraftResult } from '../domain/pos-order-draft';
import {
  callFailure,
  creationFailure,
  retryDelay,
  type PosFailure,
  type PosOrderReason,
} from '../domain/pos-order-errors';
import { iikoErrorText, toAppException } from '../iiko/iiko-api.client';
import { POS_PROVIDER } from '../provider/pos-provider';
import type {
  PosCheck,
  PosCommandState,
  PosOrderInfo,
  PosProvider,
  PosStreet,
} from '../provider/pos-provider';
import { PosKeyring } from './pos-keyring';
import { PosOrderQueue } from './pos-order.queue';

/** Questions about one deliveries/create command before the attempt counts as failed (~1 minute) */
export const POS_CHECK_POLLS = 20;
/** Questions about a delivery status command (OnWay, Delivered) and the pause between them */
const STATUS_COMMAND_POLLS = 10;
const STATUS_COMMAND_EVERY_MS = 2_000;

const ROW_INCLUDE = {
  integration: { include: { payment_links: true } },
  order: {
    include: {
      items: { include: { options: true } },
      customer: { select: { name: true } },
    },
  },
} satisfies Prisma.pos_orderInclude;

type PosOrderRow = Prisma.pos_orderGetPayload<{ include: typeof ROW_INCLUDE }>;

/** Error code of a failed call (IikoApiError and AppException both carry one). */
const codeOf = (e: unknown): string =>
  e &&
  typeof e === 'object' &&
  typeof (e as { code?: unknown }).code === 'string'
    ? (e as { code: string }).code
    : 'pos_unavailable';

/** The check on the status screen a failed order turns red (docs/IIKO.md, "Ошибки и сбои"). */
const CHECK_OF: Partial<Record<PosOrderReason, PosCheck['key']>> = {
  pos_key_invalid: 'key_access',
  pos_access_denied: 'key_access',
  pos_access_blocked: 'key_access',
  pos_module_missing: 'delivery_module',
};

/**
 * Sending accepted orders to the POS (docs/IIKO.md, "Путь заказа и статусы", "Ошибки и сбои"). A
 * failure never loses the order: it stays accepted in Xmenu, the attempt is repeated with the same
 * order id (iiko creates no duplicate) up to 5 times within 10 minutes, then the order is "not sent"
 * and the operator retries or enters it by hand. A refusal is not repeated.
 */
@Injectable()
export class PosOrderService {
  private readonly logger = new Logger('PosOrder');
  /** Waiting between status command questions; tests make it instant */
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  constructor(
    private readonly prisma: PrismaService,
    @Inject(POS_PROVIDER) private readonly provider: PosProvider,
    private readonly keyring: PosKeyring,
    private readonly transitions: OrderTransitionService,
    private readonly restaurant: RestaurantNotifierService,
    private readonly queue: PosOrderQueue,
  ) {}

  private load(orderId: string): Promise<PosOrderRow | null> {
    return this.prisma.pos_order.findUnique({
      where: { order_id: orderId },
      include: ROW_INCLUDE,
    });
  }

  /** One attempt to send the order (job `push`). */
  async push(orderId: string): Promise<void> {
    const row = await this.load(orderId);
    if (!row || row.state !== 'queued') return;
    // Cancelled or finished while waiting: nothing to cook
    if (!LIVE_STATUSES.includes(row.order.status as OrderStatusName)) return;

    const built = await this.build(row);
    if (!built.ok) {
      if (built.problem === 'needs_street') {
        const moved = await this.prisma.pos_order.updateMany({
          where: { id: row.id, state: 'queued' },
          data: { state: 'needs_street', error: null },
        });
        if (moved.count)
          await this.alertOnce(row, 'needs_street', { kind: 'needs_street' });
        return;
      }
      return this.fail(
        row,
        { id: row.id, state: 'queued' },
        { reason: built.problem, retry: false },
        row.attempts,
      );
    }

    const attempt = row.attempts + 1;
    const claimed = await this.prisma.pos_order.updateMany({
      where: { id: row.id, state: 'queued', attempts: row.attempts },
      data: { state: 'sending', attempts: attempt, correlation_id: null },
    });
    if (!claimed.count) return;
    const sending = {
      id: row.id,
      state: 'sending' as const,
      attempts: attempt,
    };

    let created: { correlationId: string; info: PosOrderInfo | null };
    try {
      created = await this.provider.createOrder(
        this.keyring.credentials(row.integration),
        row.integration.external_org_id!,
        built.draft,
      );
    } catch (e) {
      this.logger.warn(
        `order ${row.order.number} of integration ${row.integration_id}, attempt ${attempt}: ${iikoErrorText(e)}`,
      );
      return this.fail(row, sending, callFailure(codeOf(e)), attempt);
    }
    await this.prisma.pos_order.updateMany({
      where: sending,
      data: { correlation_id: created.correlationId },
    });
    const where = { ...sending, correlation_id: created.correlationId };
    if (created.info?.creation === 'success')
      return this.created(row, where, created.info);
    if (created.info?.creation === 'error')
      return this.fail(
        row,
        where,
        creationFailure(created.info.errorCode),
        attempt,
      );
    await this.queue.check(orderId, created.correlationId, 0);
  }

  /** The result of the create command (job `check`). */
  async check(
    orderId: string,
    correlationId: string,
    polls: number,
  ): Promise<void> {
    const row = await this.load(orderId);
    if (!row || row.state !== 'sending' || row.correlation_id !== correlationId)
      return;
    const where = {
      id: row.id,
      state: 'sending' as const,
      correlation_id: correlationId,
    };
    const cred = this.keyring.credentials(row.integration);
    const orgId = row.integration.external_org_id!;
    let state: PosCommandState;
    try {
      state = await this.provider.commandStatus(cred, orgId, correlationId);
    } catch (e) {
      return this.fail(row, where, callFailure(codeOf(e)), row.attempts);
    }
    if (state.state === 'in_progress') {
      if (polls + 1 < POS_CHECK_POLLS)
        return this.queue.check(orderId, correlationId, polls + 1);
      return this.fail(
        row,
        where,
        { reason: 'pos_not_taken', retry: true },
        row.attempts,
      );
    }
    // The order itself tells how its creation ended and why it failed
    const info = await this.provider
      .orders(cred, orgId, [orderId])
      .then((list) => list[0] ?? null)
      .catch(() => null);
    if (
      info?.creation === 'success' ||
      (state.state === 'success' && info?.creation !== 'error')
    )
      return this.created(row, where, info);
    if (state.state === 'error' || info?.creation === 'error')
      return this.fail(
        row,
        where,
        creationFailure(
          info?.errorCode ?? (state.state === 'error' ? state.errorCode : null),
        ),
        row.attempts,
      );
    // iiko forgot the command and does not know the order: another attempt with the same id
    return this.fail(
      row,
      where,
      { reason: 'pos_unavailable', retry: true },
      row.attempts,
    );
  }

  /**
   * A webhook or a poll reported how the creation of an order being sent ended (DeliveryOrderError,
   * DeliveryOrderUpdate with creationStatus). Returns false when the order was not being sent.
   */
  async creationReported(info: PosOrderInfo): Promise<boolean> {
    const row = await this.load(info.id);
    if (!row || row.state !== 'sending') return false;
    const where = { id: row.id, state: 'sending' as const };
    if (info.creation === 'success') await this.created(row, where, info);
    else if (info.creation === 'error')
      await this.fail(
        row,
        where,
        creationFailure(info.errorCode),
        row.attempts,
      );
    return true;
  }

  private async build(row: PosOrderRow): Promise<DraftResult> {
    const order = row.order;
    const integrationId = row.integration_id;
    const productIds = order.items.flatMap((i) =>
      i.product_id ? [i.product_id] : [],
    );
    const optionIds = order.items.flatMap((i) =>
      i.options.flatMap((o) => (o.option_id ? [o.option_id] : [])),
    );
    const [branch, products, options] = await Promise.all([
      this.prisma.pos_branch_link.findUnique({
        where: { branch_id: order.branch_id },
        select: { integration_id: true, terminal_group_id: true },
      }),
      this.prisma.pos_menu_link.findMany({
        where: {
          integration_id: integrationId,
          kind: 'product',
          product_id: { in: productIds },
        },
        select: { product_id: true, external_id: true, size_id: true },
      }),
      this.prisma.pos_menu_link.findMany({
        where: {
          integration_id: integrationId,
          kind: { in: ['size', 'modifier'] },
          option_id: { in: optionIds },
        },
        select: {
          option_id: true,
          kind: true,
          external_id: true,
          size_id: true,
        },
      }),
    ]);
    if (!branch || branch.integration_id !== integrationId)
      return { ok: false, problem: 'unmapped_branch' };
    const integration = row.integration;
    return buildPosOrder(
      {
        id: order.id,
        number: order.number,
        fulfillment: order.fulfillment,
        phone: order.phone,
        comment: order.comment,
        customerName: order.customer.name,
        paymentMethod: order.payment_method,
        paymentStatus: order.payment_status,
        total: order.total,
        deliveryFee: order.delivery_fee,
        address: order.address_snapshot,
        items: [...order.items]
          .sort((a, b) => a.position - b.position)
          .map((i) => ({
            productId: i.product_id,
            basePrice: i.base_price,
            quantity: i.quantity,
            options: [...i.options]
              .sort((a, b) => a.position - b.position)
              .map((o) => ({ optionId: o.option_id, price: o.price })),
          })),
      },
      {
        terminalGroupId: branch.terminal_group_id,
        addressFormat: integration.address_format,
        street:
          row.street_id && row.house
            ? { id: row.street_id, house: row.house }
            : null,
        products: new Map(
          products.map((p) => [
            p.product_id!,
            { externalId: p.external_id, sizeId: p.size_id },
          ]),
        ),
        options: new Map(
          options.map((o) => [
            o.option_id!,
            {
              kind: o.kind as 'size' | 'modifier',
              externalId: o.external_id,
              sizeId: o.size_id,
            },
          ]),
        ),
        payments: new Map(
          integration.payment_links.map((l) => [
            l.method,
            { id: l.payment_type_id, kind: l.payment_type_kind },
          ]),
        ),
        deliveryItem: integration.delivery_item_id
          ? {
              id: integration.delivery_item_id,
              sizeId: integration.delivery_size_id,
            }
          : null,
      },
    );
  }

  /** iiko created the order: it is confirmed at once (docs/IIKO.md, decision 6). */
  private async created(
    row: PosOrderRow,
    where: Prisma.pos_orderWhereInput,
    info: PosOrderInfo | null,
  ): Promise<void> {
    const done = await this.prisma.pos_order.updateMany({
      where,
      data: {
        state: 'sent',
        sent_at: new Date(),
        error: null,
        alerted: null,
        ...(info?.number ? { pos_number: info.number } : {}),
      },
    });
    if (!done.count) return;
    await this.journal(row.order_id, row.order.status, 'iiko:sent');
    await this.confirm(row);
    // The operator heard about a failure: tell that it went through after all
    if (row.alerted)
      await this.alert(row, {
        kind: 'sent',
        posNumber: info?.number ?? row.pos_number,
      });
  }

  /** deliveries/confirm; an order already confirmed or a failure is only logged. */
  async confirm(row: {
    order_id: string;
    integration: {
      id: string;
      api_key_encrypted: string;
      external_org_id: string | null;
    };
  }): Promise<void> {
    try {
      await this.provider.confirmOrder(
        this.keyring.credentials(row.integration),
        row.integration.external_org_id!,
        row.order_id,
      );
    } catch (e) {
      this.logger.warn(
        `confirm of order ${row.order_id} failed: ${iikoErrorText(e)}`,
      );
    }
  }

  /**
   * A failed attempt: another one after a pause while the round lasts and the failure can pass,
   * otherwise "not sent" (state failed). The operator is alerted once per state.
   */
  private async fail(
    row: PosOrderRow,
    where: Prisma.pos_orderWhereInput,
    failure: PosFailure,
    attemptsMade: number,
  ): Promise<void> {
    const delay = failure.retry ? retryDelay(attemptsMade) : null;
    const next = delay === null ? 'failed' : 'queued';
    const moved = await this.prisma.pos_order.updateMany({
      where,
      data: { state: next, error: failure.reason, correlation_id: null },
    });
    if (!moved.count) return;
    this.logger.warn(
      `order ${row.order.number} of integration ${row.integration_id}: ${failure.reason}, ${next}`,
    );
    await this.journal(
      row.order_id,
      row.order.status,
      `iiko:${next === 'failed' ? 'failed' : 'retry'}:${failure.reason}`,
    );
    if (delay !== null) {
      await this.queue.push(row.order_id, attemptsMade, delay);
      await this.alertOnce(row, 'retrying', {
        kind: 'retrying',
        reason: failure.reason,
      });
    } else {
      await this.alertOnce(row, 'failed', {
        kind: 'failed',
        reason: failure.reason,
      });
    }
    await this.integrationProblem(row, failure.reason);
  }

  /**
   * The key or the rights stopped working: the status screen check turns red; a rejected key marks
   * the integration "needs reconnect" (orders keep being accepted) and alerts the venue once.
   */
  private async integrationProblem(row: PosOrderRow, reason: PosOrderReason) {
    const key = CHECK_OF[reason];
    if (!key) return;
    const checks = ((row.integration.checks as PosCheck[] | null) ?? []).filter(
      (c) => c.key !== key,
    );
    checks.push({ key, status: 'fail', code: reason });
    await this.prisma.pos_integration.update({
      where: { id: row.integration_id },
      data: {
        checks: checks as unknown as Prisma.InputJsonValue,
        checked_at: new Date(),
      },
    });
    if (reason !== 'pos_key_invalid') return;
    const marked = await this.prisma.pos_integration.updateMany({
      where: { id: row.integration_id, status: 'active' },
      data: { status: 'needs_reconnect' },
    });
    if (marked.count)
      await this.restaurant
        .alertPosReconnect(row.integration.organization_id)
        .catch(() => undefined);
  }

  private async alertOnce(row: PosOrderRow, key: string, alert: PosAlert) {
    const marked = await this.prisma.pos_order.updateMany({
      where: { id: row.id, NOT: { alerted: key } },
      data: { alerted: key },
    });
    if (marked.count) await this.alert(row, alert);
  }

  private async alert(row: { order_id: string }, alert: PosAlert) {
    try {
      await this.restaurant.alertPos(row.order_id, alert);
    } catch (e) {
      this.logger.warn(
        `alert ${alert.kind} of order ${row.order_id} not sent: ${iikoErrorText(e)}`,
      );
    }
  }

  private journal(orderId: string, status: string, note: string) {
    return this.transitions.recordInTx(this.prisma, {
      orderId,
      status: status as OrderStatusName,
      actor: 'pos',
      note,
    });
  }

  // ---- The operator (docs/API.md, "Передача заказа в iiko") ----

  private async staffRow(organizationId: string, orderId: string) {
    const order = await this.prisma.customer_order.findFirst({
      where: { id: orderId, organization_id: organizationId },
      select: { id: true },
    });
    if (!order)
      throw new AppException('not_found', { message: 'Order not found' });
    const row = await this.load(orderId);
    if (!row) throw new AppException('pos_not_connected');
    return row;
  }

  private async view(orderId: string) {
    const row = await this.prisma.pos_order.findUniqueOrThrow({
      where: { order_id: orderId },
    });
    return toPosView(row);
  }

  /** "Повторить": a new round of attempts for an order that was not sent. */
  async retry(organizationId: string, orderId: string, staffId: string) {
    const row = await this.staffRow(organizationId, orderId);
    if (!LIVE_STATUSES.includes(row.order.status as OrderStatusName))
      throw new AppException('pos_order_state_conflict', {
        message: 'The order is finished',
      });
    const moved = await this.prisma.pos_order.updateMany({
      where: { id: row.id, state: 'failed' },
      data: { state: 'queued', attempts: 0, error: null, alerted: null },
    });
    if (!moved.count)
      throw new AppException('pos_order_state_conflict', {
        message: 'Only an order that was not sent is retried',
      });
    await this.transitions.recordInTx(this.prisma, {
      orderId,
      status: row.order.status as OrderStatusName,
      actor: 'restaurant',
      actorId: staffId,
      note: 'iiko:retry_by_staff',
    });
    await this.startRound(orderId);
    return this.view(orderId);
  }

  /** "Внесён вручную": the operator typed the order into iiko; no more attempts. */
  async manual(
    organizationId: string,
    orderId: string,
    posNumber: string | null,
    staffId: string,
  ) {
    const row = await this.staffRow(organizationId, orderId);
    const moved = await this.prisma.pos_order.updateMany({
      where: {
        id: row.id,
        state: { in: ['failed', 'needs_street', 'queued'] },
      },
      data: {
        state: 'manual',
        manual_at: new Date(),
        manual_by: staffId,
        pos_number: posNumber,
        correlation_id: null,
      },
    });
    if (!moved.count)
      throw new AppException('pos_order_state_conflict', {
        message: 'The order is already in iiko or being sent',
      });
    await this.transitions.recordInTx(this.prisma, {
      orderId,
      status: row.order.status as OrderStatusName,
      actor: 'restaurant',
      actorId: staffId,
      note: 'iiko:manual',
    });
    return this.view(orderId);
  }

  /** Streets of the iiko directory for an order whose address needs one. */
  async streets(
    organizationId: string,
    orderId: string,
    query: string,
  ): Promise<PosStreet[]> {
    const row = await this.staffRow(organizationId, orderId);
    if (row.state !== 'needs_street')
      throw new AppException('pos_order_state_conflict', {
        message: 'The order does not wait for a street',
      });
    try {
      return await this.provider.streets(
        this.keyring.credentials(row.integration),
        row.integration.external_org_id!,
        query,
      );
    } catch (e) {
      throw toAppException(e);
    }
  }

  /** The operator picked the street and the house: the order goes to iiko. */
  async setStreet(
    organizationId: string,
    orderId: string,
    street: { streetId: string; house: string },
    staffId: string,
  ) {
    const row = await this.staffRow(organizationId, orderId);
    if (!LIVE_STATUSES.includes(row.order.status as OrderStatusName))
      throw new AppException('pos_order_state_conflict', {
        message: 'The order is finished',
      });
    const moved = await this.prisma.pos_order.updateMany({
      where: { id: row.id, state: { in: ['needs_street', 'failed'] } },
      data: {
        street_id: street.streetId,
        house: street.house,
        state: 'queued',
        attempts: 0,
        error: null,
        alerted: null,
      },
    });
    if (!moved.count)
      throw new AppException('pos_order_state_conflict', {
        message: 'The order does not wait for a street',
      });
    await this.transitions.recordInTx(this.prisma, {
      orderId,
      status: row.order.status as OrderStatusName,
      actor: 'restaurant',
      actorId: staffId,
      note: 'iiko:street',
    });
    await this.startRound(orderId);
    return this.view(orderId);
  }

  /** A new round of attempts; without queues (ORDER_QUEUES=off) the order stays queued, as after accepting. */
  private startRound(orderId: string) {
    return this.queue.push(orderId, 0, 0, Date.now().toString(36));
  }

  // ---- Own couriers (docs/IIKO.md, "Курьеры") ----

  /**
   * An own courier delivered an order iiko has: iiko gets "on the way", then "delivered" (it moves
   * only between neighbouring statuses); closing the order stays with the cash desk. A step iiko
   * refuses is written to the journal and alerts the operator; the Xmenu status stays.
   */
  async delivered(orderId: string): Promise<void> {
    const row = await this.load(orderId);
    if (!row || row.state !== 'sent') return;
    if (row.delivered_push !== 'pending' && row.delivered_push !== 'on_way')
      return;
    const cred = this.keyring.credentials(row.integration);
    const orgId = row.integration.external_org_id!;
    const steps: {
      status: 'OnWay' | 'Delivered';
      from: 'pending' | 'on_way';
      to: 'on_way' | 'done';
    }[] = [
      { status: 'OnWay', from: 'pending', to: 'on_way' },
      { status: 'Delivered', from: 'on_way', to: 'done' },
    ];
    let at: string = row.delivered_push;
    for (const step of steps) {
      if (at !== step.from) continue;
      let ok = false;
      try {
        const cid = await this.provider.setDeliveryStatus(
          cred,
          orgId,
          orderId,
          step.status,
        );
        ok = await this.commandDone(cred, orgId, cid);
      } catch (e) {
        this.logger.warn(
          `${step.status} of order ${row.order.number} failed: ${iikoErrorText(e)}`,
        );
      }
      if (!ok) {
        await this.prisma.pos_order.updateMany({
          where: { id: row.id, delivered_push: step.from },
          data: { delivered_push: 'failed' },
        });
        await this.journal(
          orderId,
          row.order.status,
          `iiko:${step.status}:failed`,
        );
        await this.alert(row, { kind: 'delivered_push_failed' });
        return;
      }
      await this.prisma.pos_order.updateMany({
        where: { id: row.id, delivered_push: step.from },
        data: { delivered_push: step.to },
      });
      await this.journal(orderId, row.order.status, `iiko:${step.status}`);
      at = step.to;
    }
  }

  private async commandDone(
    cred: ReturnType<PosKeyring['credentials']>,
    orgId: string,
    correlationId: string,
  ): Promise<boolean> {
    for (let i = 0; i < STATUS_COMMAND_POLLS; i++) {
      const st = await this.provider.commandStatus(cred, orgId, correlationId);
      if (st.state === 'success') return true;
      if (st.state !== 'in_progress') return false;
      await this.sleep(STATUS_COMMAND_EVERY_MS);
    }
    return false;
  }
}
