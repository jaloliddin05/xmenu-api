import { paidAtDoor } from '../domain/delivery-payment';
import { errorMessage } from 'src/infra/helper/error-text';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, customer_order } from '@prisma/client';
import { AppException } from 'src/infra/errors/app-exception';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  courierPay,
  deliveryDistanceKm,
  effectiveRate,
  payRateOf,
} from 'src/modules/courier/domain/courier-pay';
import { deliveryTimerFor } from '../domain/delivery-timers';
import {
  FulfillmentName,
  OrderActorName,
  OrderStatusName,
  checkTransition,
} from '../domain/order-state-machine';
import { CustomerNotifierService } from '../notifications/customer-notifier.service';
import type { PosAlert } from '../notifications/order-messages';
import { RestaurantNotifierService } from '../notifications/restaurant-notifier.service';
import { OrderQueueService } from '../queue/order-queue.service';
import { OrderSettingsService } from './order-settings.service';
import { isPosLive } from 'src/modules/pos/domain/pos-steps';
import { StaffPushService } from 'src/modules/push/staff-push.service';

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: OrderStatusName,
    public readonly to: OrderStatusName,
    public readonly reason: 'final' | 'not_allowed' | 'wrong_fulfillment',
  ) {
    super(`Order transition ${from} -> ${to} refused: ${reason}`);
  }
}

export class OrderNotFoundError extends Error {}
/** A courier pressed a button of an order that is not (or no longer) assigned to them. */
export class CourierNotAssignedError extends Error {}
class VersionConflictError extends Error {}

export interface TransitionInput {
  orderId: string;
  to: OrderStatusName;
  actor: OrderActorName;
  actorId?: string;
  /** audit jurnali uchun izoh (payment_failed sababi: 'declined' | 'expired' | 'cancelled') */
  note?: string;
  /** bekor qilish sababi (customer_order.cancel_reason) */
  reason?: string;
  /** awaiting_payment (qayta urinish): yangi to'lov muddati */
  paymentExpiresAt?: Date;
  /**
   * The status the caller saw when it decided (a Telegram button, a scan): the transition is refused when the
   * order is in another status by now, even if the target is reachable from there too
   */
  expectedFrom?: OrderStatusName;
  /** problem_at_door: what happened at the door (refused: with a reason code) */
  doorProblem?: { kind: 'no_answer' | 'refused'; reason?: string };
  /** completed, cash order: how the guest paid the courier (banknotes by default, or a card) */
  cashCollected?: 'cash' | 'card';
  /** handed_to_external: the service and what the venue paid it */
  external?: { service: string; cost: number };
}

/** Why the operator gets an urgent message about a delivery. */
export type OperatorAlertKind = 'no_answer' | 'refused' | 'cannot_deliver';

export type Effect =
  | {
      type: 'status_changed';
      from: OrderStatusName | null;
      to: OrderStatusName;
    }
  | { type: 'placed' }
  | { type: 'payment_window'; expiresAt: Date }
  | { type: 'refund' }
  /** Rebuild the order card in this courier's chat */
  | { type: 'courier_card'; courierId: string }
  | { type: 'operator_alert'; kind: OperatorAlertKind }
  /** A delivery changed status: drop its pending timers, schedule the one of the new status */
  | { type: 'delivery_timers' }
  /** The order goes to the POS (accepted) or the POS hears that an own courier delivered it */
  | { type: 'pos_job'; name: 'push' | 'delivered' }
  /** A message to the branch chat about the order in the POS */
  | { type: 'pos_alert'; alert: PosAlert }
  /** Web push to the venue staff (the new order is sent on placed) */
  | { type: 'staff_push'; event: 'at_door' | 'cannot_deliver' };

/**
 * Effects of the steps of one chain: a single status change (first from → last to) and every other effect
 * once. A single step comes back unchanged.
 */
export function mergeStepEffects(
  effects: readonly Effect[],
  from: OrderStatusName,
  to: OrderStatusName,
): Effect[] {
  const changes = effects.filter((e) => e.type === 'status_changed');
  if (changes.length <= 1) return [...effects];
  const seen = new Set<string>();
  const out: Effect[] = [{ type: 'status_changed', from, to }];
  for (const e of effects) {
    if (e.type === 'status_changed') continue;
    const key = JSON.stringify(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export interface TransitionResult {
  order: customer_order;
  from: OrderStatusName;
  effects: Effect[];
}

/**
 * Buyurtma holatini o'zgartirishning YAGONA yo'li.
 *
 *  1. Ruxsat — order-state-machine.ts (kim, qaysi holatdan, qaysi holatga).
 *  2. Optimistik blok — `version`: UPDATE ... WHERE id AND version = <o'qilgan>.
 *     Ikki odam bir vaqtda (restoran "Принять" va mijoz "Отменить", yoki
 *     to'lov webhook'i va avto-bekor) bosganda faqat BIRI o'tadi, ikkinchisi
 *     qayta o'qib, endi ruxsat etilmaganini ko'radi.
 *  3. Audit — order_status_event (kim, qachon, nimadan nimaga).
 *  4. Yon ta'sirlar (xabarnomalar, navbatlar, qaytarish) — tranzaksiya
 *     COMMIT bo'lgandan KEYIN va xato bersa ham buyurtmaga ta'sir qilmaydi.
 *
 * transitionInTx() tashqi tranzaksiyaga qo'shiladi (to'lov webhook'i to'lov
 * yozuvi va buyurtma holatini bitta atomik qadamda yangilaydi); effects ni
 * commit'dan keyin runEffects() bilan ishga tushirish chaqiruvchining vazifasi.
 */
@Injectable()
export class OrderTransitionService {
  private readonly logger = new Logger('OrderTransition');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: OrderSettingsService,
    private readonly restaurant: RestaurantNotifierService,
    private readonly customer: CustomerNotifierService,
    private readonly queues: OrderQueueService,
    private readonly staffPush: StaffPushService,
  ) {}

  async transitionInTx(
    tx: Prisma.TransactionClient,
    input: TransitionInput,
  ): Promise<TransitionResult> {
    const order = await tx.customer_order.findUnique({
      where: { id: input.orderId },
    });
    if (!order) throw new OrderNotFoundError(input.orderId);

    const from = order.status as OrderStatusName;
    const check = checkTransition(
      from,
      input.to,
      input.actor,
      order.fulfillment as FulfillmentName,
    );
    if (!check.ok)
      throw new InvalidTransitionError(from, input.to, check.reason);
    if (input.expectedFrom && from !== input.expectedFrom)
      throw new InvalidTransitionError(from, input.to, 'not_allowed');
    // Only the courier assigned to this order moves it (docs/DELIVERY.md, "Безопасность")
    if (input.actor === 'courier' && order.courier_id !== input.actorId)
      throw new CourierNotAssignedError();
    // At the door only a guest who did not answer can still get the order; a refusal waits for the operator
    if (
      from === 'problem_at_door' &&
      input.to === 'completed' &&
      order.door_problem !== 'no_answer'
    )
      throw new InvalidTransitionError(from, input.to, 'not_allowed');

    const now = new Date();
    const data: Prisma.customer_orderUncheckedUpdateManyInput = {
      status: input.to,
      version: { increment: 1 },
    };
    const effects: Effect[] = [{ type: 'status_changed', from, to: input.to }];

    switch (input.to) {
      case 'pending_acceptance':
        data.placed_at = order.placed_at ?? now;
        if (from === 'awaiting_payment') {
          data.payment_status = 'paid';
          data.payment_expires_at = null;
        }
        effects.push({ type: 'placed' });
        break;
      case 'accepted':
        data.accepted_at = now;
        if (await this.queueForPos(tx, order))
          effects.push({ type: 'pos_job', name: 'push' });
        break;
      case 'completed':
        data.completed_at = now;
        if (order.fulfillment === 'delivery' && order.courier_id)
          Object.assign(data, await this.deliveredByCourier(tx, order, input));
        // Own couriers of a venue with iiko: iiko hears "on the way" and "delivered" (docs/IIKO.md, "Курьеры")
        if (input.actor === 'courier') {
          const handed = await tx.pos_order.updateMany({
            where: {
              order_id: order.id,
              state: 'sent',
              delivered_push: 'none',
            },
            data: { delivered_push: 'pending' },
          });
          if (handed.count)
            effects.push({ type: 'pos_job', name: 'delivered' });
        }
        break;
      case 'on_the_way':
        data.picked_up_at = now;
        break;
      case 'handed_to_external':
        // Only instead of an own courier (docs/DELIVERY.md, "Передача внешней службе")
        if (order.courier_id) throw new AppException('order_courier_assigned');
        if (!input.external)
          throw new Error('handed_to_external needs the external service');
        data.external_service = input.external.service;
        data.external_cost = input.external.cost;
        data.external_handed_at = now;
        data.external_cash_received = null;
        break;
      case 'ready':
        data.ready_at = now;
        // "Cannot deliver" (or the courier was disabled): ready again, without a courier; the operator
        // assigns another one
        if (from === 'on_the_way' || from === 'problem_at_door') {
          data.courier_id = null;
          data.courier_assigned_at = null;
          data.courier_shift_id = null;
          data.door_problem = null;
          data.door_problem_reason = null;
          effects.push({ type: 'operator_alert', kind: 'cannot_deliver' });
          // The courier said so; a disabled courier (system) is the owner's own doing, the chat alert is enough
          if (input.actor === 'courier')
            effects.push({ type: 'staff_push', event: 'cannot_deliver' });
        }
        break;
      case 'problem_at_door': {
        const kind = input.doorProblem?.kind ?? 'no_answer';
        data.door_problem = kind;
        data.door_problem_reason = input.doorProblem?.reason ?? null;
        data.door_problem_at = now;
        effects.push({ type: 'operator_alert', kind });
        effects.push({ type: 'staff_push', event: 'at_door' });
        break;
      }
      case 'payment_failed':
        data.payment_status = 'failed';
        break;
      case 'awaiting_payment':
        data.payment_status = 'pending';
        data.payment_expires_at = input.paymentExpiresAt ?? null;
        if (input.paymentExpiresAt)
          effects.push({
            type: 'payment_window',
            expiresAt: input.paymentExpiresAt,
          });
        break;
      case 'cancelled':
        data.cancelled_by = input.actor === 'payment' ? 'system' : input.actor;
        data.cancel_reason = input.reason ?? null;
        data.cancelled_at = now;
        data.payment_expires_at = null;
        if (order.payment_status === 'paid') {
          // Pul olingan — qaytarish navbatga qo'yiladi (Click avtomatik, Payme qo'lda).
          data.payment_status = 'refund_pending';
          effects.push({ type: 'refund' });
        } else if (order.payment_status === 'pending') {
          data.payment_status = 'cancelled';
        }
        // Changing an order already in iiko is out of the MVP: the operator cancels it there by hand
        if (
          input.actor !== 'pos' &&
          (await tx.pos_order.count({
            where: { order_id: order.id, state: { in: ['sending', 'sent'] } },
          }))
        )
          effects.push({ type: 'pos_alert', alert: { kind: 'cancel_in_pos' } });
        break;
    }

    if (order.fulfillment === 'delivery')
      effects.push({ type: 'delivery_timers' });

    // Every change of an order with a courier rebuilds the courier's card (the old one too, after "cannot deliver")
    if (order.courier_id)
      effects.push({ type: 'courier_card', courierId: order.courier_id });

    const updated = await tx.customer_order.updateMany({
      where: { id: order.id, version: order.version },
      data,
    });
    if (updated.count === 0) throw new VersionConflictError();

    await tx.order_status_event.create({
      data: {
        order_id: order.id,
        from_status: from,
        to_status: input.to,
        actor: input.actor,
        actor_id: input.actorId ?? null,
        note: input.note ?? input.reason ?? null,
      },
    });

    const fresh = await tx.customer_order.findUniqueOrThrow({
      where: { id: order.id },
    });
    return { order: fresh, from, effects };
  }

  /**
   * A courier delivered: how a cash order was paid, and the courier's pay at this moment (the courier's own
   * rate or the venue's; km in a straight line from the branch to the address).
   */
  private async deliveredByCourier(
    tx: Prisma.TransactionClient,
    order: customer_order,
    input: TransitionInput,
  ): Promise<Prisma.customer_orderUncheckedUpdateManyInput> {
    const [courier, branch, settings] = await Promise.all([
      tx.courier.findUnique({
        where: { id: order.courier_id! },
        select: {
          pay_per_delivery: true,
          pay_included_km: true,
          pay_per_km: true,
        },
      }),
      tx.branch.findUnique({
        where: { id: order.branch_id },
        select: { latitude: true, longitude: true },
      }),
      this.settings.get(order.organization_id),
    ]);
    const rate = effectiveRate(
      courier
        ? payRateOf({
            perDelivery: courier.pay_per_delivery,
            includedKm: courier.pay_included_km,
            perKm: courier.pay_per_km,
          })
        : null,
      settings.courierPay,
    );
    const km = branch ? deliveryDistanceKm(branch, order.address_snapshot) : 0;
    return {
      // Paid at the door: the courier marks banknotes or a card whatever the guest chose at checkout
      cash_collected: paidAtDoor(order.payment_method)
        ? (input.cashCollected ?? order.payment_method)
        : null,
      courier_distance_km: Math.round(km * 1000) / 1000,
      courier_pay: courierPay(rate, km),
    };
  }

  /**
   * An accepted order of a branch linked to an enabled POS integration gets its pos_order row in the
   * same transaction (docs/IIKO.md, "Путь заказа и статусы"); a branch without a link sends nothing.
   */
  private async queueForPos(
    tx: Prisma.TransactionClient,
    order: customer_order,
  ): Promise<boolean> {
    const link = await tx.pos_branch_link.findUnique({
      where: { branch_id: order.branch_id },
      select: {
        integration_id: true,
        integration: { select: { status: true } },
      },
    });
    if (!link || !isPosLive(link.integration.status)) return false;
    await tx.pos_order.upsert({
      where: { order_id: order.id },
      create: { order_id: order.id, integration_id: link.integration_id },
      update: {},
    });
    return true;
  }

  /**
   * A journal entry without a status change (a courier assigned or taken off): who, what, when. The status
   * is written as both from and to, the action goes to `note`.
   */
  async recordInTx(
    tx: Prisma.TransactionClient,
    input: {
      orderId: string;
      status: OrderStatusName;
      actor: OrderActorName;
      actorId?: string;
      note: string;
    },
  ): Promise<void> {
    await tx.order_status_event.create({
      data: {
        order_id: input.orderId,
        from_status: input.status,
        to_status: input.status,
        actor: input.actor,
        actor_id: input.actorId ?? null,
        note: input.note,
      },
    });
  }

  /** Alohida tranzaksiyada o'tkazadi; versiya to'qnashuvida qayta o'qib urinadi. */
  transition(input: TransitionInput): Promise<TransitionResult> {
    return this.commit(input, [input.to]);
  }

  /**
   * Several steps in one transaction, each checked by the state machine and written to the journal: a pickup
   * marked ready straight from accepted passes preparing (one drag on the operator's board). The first step
   * starts from `expectedFrom`, each next one from the step before. The effects of the steps are merged: the
   * guest hears one status change, from the first status to the last.
   */
  transitionChain(
    input: Omit<TransitionInput, 'to'>,
    steps: readonly OrderStatusName[],
  ): Promise<TransitionResult> {
    return this.commit({ ...input, to: steps[steps.length - 1] }, steps);
  }

  private async commit(
    input: TransitionInput,
    steps: readonly OrderStatusName[],
  ): Promise<TransitionResult> {
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const results: TransitionResult[] = [];
          for (const [i, to] of steps.entries())
            results.push(
              await this.transitionInTx(tx, {
                ...input,
                to,
                expectedFrom: i === 0 ? input.expectedFrom : steps[i - 1],
              }),
            );
          const first = results[0];
          const last = results[results.length - 1];
          return {
            order: last.order,
            from: first.from,
            effects: mergeStepEffects(
              results.flatMap((r) => r.effects),
              first.from,
              last.order.status as OrderStatusName,
            ),
          };
        });
        this.dispatchEffects(result.order, result.effects);
        return result;
      } catch (e) {
        if (e instanceof VersionConflictError && attempt < 3) continue;
        if (e instanceof VersionConflictError) {
          // Qayta o'qiganda holat o'zgargan: eng ishonchli javob — endi o'tish ruxsat etilmasligi.
          const now = await this.prisma.customer_order.findUnique({
            where: { id: input.orderId },
            select: { status: true, fulfillment: true },
          });
          if (!now) throw new OrderNotFoundError(input.orderId);
          const check = checkTransition(
            now.status as OrderStatusName,
            steps[0],
            input.actor,
            now.fulfillment as FulfillmentName,
          );
          throw new InvalidTransitionError(
            now.status as OrderStatusName,
            input.to,
            check.ok ? 'not_allowed' : check.reason,
          );
        }
        throw e;
      }
    }
  }

  /**
   * Commit'dan KEYIN effektlarni FONDA ishga tushiradi: Telegram/Redis sekin
   * bo'lsa ham HTTP javob (yoki Click/Payme webhook javobi — ularda qisqa
   * timeout bor) kechikmaydi. Xato — faqat log (runEffects ichida).
   */
  dispatchEffects(order: customer_order, effects: Effect[]): void {
    void this.runEffects(order, effects);
  }

  /** Commit'dan KEYIN: xabarnomalar, navbatlar. Xato — faqat log. */
  async runEffects(order: customer_order, effects: Effect[]): Promise<void> {
    const placed = effects.some((e) => e.type === 'placed');

    for (const effect of effects) {
      try {
        switch (effect.type) {
          case 'placed': {
            await this.staffPush.notify(order.id, 'new_order', order.version);
            const notified = await this.restaurant.notifyNewOrder(order.id);
            if (!notified)
              this.logger.warn(
                `Buyurtma ${order.number}: restoranga Telegram xabari yuborilmadi (eskalatsiya baribir ishlaydi)`,
              );
            const s = await this.settings.get(order.organization_id);
            await this.queues.scheduleAcceptanceEscalation(
              order.id,
              s.acceptanceTimeoutSeconds,
            );
            break;
          }
          case 'status_changed':
            await this.customer.notifyStatus(order.id, effect.from);
            if (!placed) await this.restaurant.refreshMessage(order.id);
            break;
          case 'payment_window':
            await this.queues.schedulePaymentExpiry(order.id, effect.expiresAt);
            break;
          case 'refund':
            await this.queues.enqueueRefund(order.id);
            break;
          case 'courier_card':
            await this.queues.enqueueCourierCard(
              order.id,
              effect.courierId,
              order.version,
            );
            break;
          case 'operator_alert':
            await this.restaurant.alertDeliveryProblem(order.id, effect.kind);
            break;
          case 'pos_job':
            await this.queues.enqueuePosOrder(effect.name, order.id);
            break;
          case 'pos_alert':
            await this.restaurant.alertPos(order.id, effect.alert);
            break;
          case 'staff_push':
            await this.staffPush.notify(order.id, effect.event, order.version);
            break;
          case 'delivery_timers': {
            const s = await this.settings.get(order.organization_id);
            await this.queues.resetDeliveryTimers(
              order.id,
              deliveryTimerFor(order, s),
            );
            break;
          }
        }
      } catch (e) {
        this.logger.error(
          `Effect ${effect.type} (order ${order.number}) failed: ${errorMessage(e)}`,
        );
      }
    }
  }
}
