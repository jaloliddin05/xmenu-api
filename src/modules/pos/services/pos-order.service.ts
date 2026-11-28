import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, type PosDeliveredPush } from '@prisma/client';
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
import { deliveredPushSteps } from '../domain/delivered-push';
import { buildPosOrder, type DraftResult } from '../domain/pos-order-draft';
import {
  callFailure,
  creationFailure,
  retryDelay,
  type PosFailure,
  type PosOrderReason,
} from '../domain/pos-order-errors';
import { isPosLive } from '../domain/pos-steps';
import { matchStreet } from '../domain/street-match';
import { iikoErrorText, toAppException } from '../iiko/iiko-api.client';
import { POS_PROVIDER } from '../provider/pos-provider';
import type {
  PosCheck,
  PosCommandState,
  PosDeliveryStatus,
  PosOrderInfo,
  PosProvider,
  PosStreet,
} from '../provider/pos-provider';
import { PosAlertService } from './pos-alert.service';
import { PosKeyring } from './pos-keyring';
import { PosOrderQueue } from './pos-order.queue';
import { PosSyncQueue } from './pos-sync.queue';
import { errorMessage } from 'src/infra/helper/error-text';
import { PosStreetsCache } from './pos-streets.cache';

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
    private readonly alerts: PosAlertService,
    private readonly streetsCache: PosStreetsCache,
    @Optional() private readonly sync?: PosSyncQueue,
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
    // Disconnected while waiting: the operator enters it by hand if needed
    if (!isPosLive(row.integration.status)) return;
    // Cancelled or finished while waiting: nothing to cook
    if (!LIVE_STATUSES.includes(row.order.status as OrderStatusName)) return;

    await this.matchStreet(row);
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
      if (codeOf(e) === 'platform_misconfigured')
        await this.alerts
          .platform(
            `order of integration ${row.integration_id}: ${iikoErrorText(e)}`,
          )
          .catch(() => undefined);
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
    if (!isPosLive(row.integration.status)) return;
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
        select: {
          integration_id: true,
          terminal_group_id: true,
        },
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
        // Only accepted orders are pushed; an anonymized order (phone null) is always final
        phone: order.phone ?? '',
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
        // One price category for the venue: the one the menu prices were imported in
        priceCategoryId: integration.price_category_id,
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

  /**
   * deliveries/confirm, once per order (audit W15-15): the confirmation is claimed by a conditional
   * update, so the Unconfirmed status reported after creation does not confirm again. A failure is
   * logged and releases the claim: the next Unconfirmed from iiko tries again.
   */
  async confirm(row: {
    order_id: string;
    integration: {
      id: string;
      api_key_encrypted: string | null;
      external_org_id: string | null;
    };
  }): Promise<void> {
    const at = new Date();
    const claimed = await this.prisma.pos_order.updateMany({
      where: { order_id: row.order_id, confirmed_at: null },
      data: { confirmed_at: at },
    });
    if (!claimed.count) return;
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
      await this.prisma.pos_order.updateMany({
        where: { order_id: row.order_id, confirmed_at: at },
        data: { confirmed_at: null },
      });
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
    await this.refreshFromPos(row.integration_id, failure.reason);
  }

  /**
   * iiko refused the order over a price or the stop list: the menu (or the stop list) in Xmenu is behind the cash
   * desk, so it is fetched now instead of on a timer; the next guest sees the cash desk's prices.
   */
  private async refreshFromPos(integrationId: string, reason: PosOrderReason) {
    try {
      if (reason === 'pos_rejected_price')
        await this.sync?.enqueue('menu', integrationId);
      if (reason === 'pos_rejected_stop_list')
        await this.sync?.enqueue('stop-list', integrationId);
    } catch (e) {
      this.logger.warn(
        `refresh of integration ${integrationId} after ${reason} not queued: ${errorMessage(e)}`,
      );
    }
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
    // Keys of several venues rejected at once: the platform's application, not this key
    if (await this.alerts.keyRejected(row.integration_id)) return;
    await this.alerts.needsReconnect(row.integration);
  }

  /**
   * The organization takes streets from the iiko directory (every format but city): the street and
   * the house are matched from the guest's address line before the order is built (decision 8). No
   * single match leaves the order to the operator (needs_street), as before.
   */
  private async matchStreet(row: PosOrderRow): Promise<void> {
    if (
      row.order.fulfillment !== 'delivery' ||
      row.integration.address_format === 'city' ||
      (row.street_id && row.house)
    )
      return;
    const address = (row.order.address_snapshot ?? {}) as { address?: unknown };
    if (typeof address.address !== 'string') return;
    let match: { streetId: string; house: string } | null = null;
    try {
      match = matchStreet(
        address.address,
        await this.streetsCache.streets(row.integration),
      );
    } catch (e) {
      this.logger.warn(
        `streets of integration ${row.integration_id} not read: ${iikoErrorText(e)}`,
      );
    }
    if (!match) return;
    const set = await this.prisma.pos_order.updateMany({
      where: { id: row.id, state: 'queued', street_id: null },
      data: { street_id: match.streetId, house: match.house },
    });
    if (!set.count) return;
    row.street_id = match.streetId;
    row.house = match.house;
    await this.journal(row.order_id, row.order.status, 'iiko:street:auto');
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
      return await this.streetsCache.search(row.integration, query);
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
   * An own courier delivered an order iiko has: iiko gets "on the way", then "delivered"; closing the
   * order stays with the cash desk. iiko moves only between neighbouring statuses (Waiting, OnWay,
   * Delivered), so the status iiko has now is read first (domain/delivered-push.ts): from a status
   * iiko would refuse nothing is sent (audit W15-06). A refused or impossible step marks "status in
   * iiko not updated" (delivered_push failed), goes to the journal and alerts the operator once; no
   * blind retries. The Xmenu status stays.
   */
  async delivered(orderId: string): Promise<void> {
    const row = await this.load(orderId);
    if (!row || row.state !== 'sent' || !isPosLive(row.integration.status))
      return;
    if (row.delivered_push !== 'pending' && row.delivered_push !== 'on_way')
      return;
    const cred = this.keyring.credentials(row.integration);
    const orgId = row.integration.external_org_id!;
    const now = await this.provider
      .orders(cred, orgId, [orderId])
      .then((list) => list[0]?.status ?? null)
      .catch((e: unknown) => {
        this.logger.warn(
          `status of order ${row.order.number} not read: ${iikoErrorText(e)}`,
        );
        return null;
      });
    const current = (now ?? row.pos_status) as PosDeliveryStatus | null;
    const plan = deliveredPushSteps(current);
    if (plan === 'blocked') {
      await this.prisma.pos_order.updateMany({
        where: { id: row.id, delivered_push: row.delivered_push },
        data: { delivered_push: 'failed' },
      });
      await this.journal(
        orderId,
        row.order.status,
        `iiko:delivered_push:blocked:${current ?? 'unknown'}`,
      );
      await this.alert(row, { kind: 'delivered_push_failed' });
      return;
    }
    const steps = (
      [
        { status: 'OnWay', from: 'pending', to: 'on_way' },
        { status: 'Delivered', from: 'on_way', to: 'done' },
      ] as const
    ).filter((step) => plan.includes(step.status));
    if (!steps.length) {
      // iiko is already past "delivered": nothing to send
      await this.prisma.pos_order.updateMany({
        where: { id: row.id, delivered_push: row.delivered_push },
        data: { delivered_push: 'done' },
      });
      return;
    }
    let at: PosDeliveredPush = row.delivered_push;
    for (const step of steps) {
      // iiko is on its way already: the Delivered step starts from "on_way"
      if (at !== step.from) {
        await this.prisma.pos_order.updateMany({
          where: { id: row.id, delivered_push: at },
          data: { delivered_push: step.from },
        });
        at = step.from;
      }
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
