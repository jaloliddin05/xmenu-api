import { Injectable, Logger } from '@nestjs/common';
import { Prisma, customer_order } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  FulfillmentName,
  OrderActorName,
  OrderStatusName,
  checkTransition,
} from '../domain/order-state-machine';
import { CustomerNotifierService } from '../notifications/customer-notifier.service';
import { RestaurantNotifierService } from '../notifications/restaurant-notifier.service';
import { OrderQueueService } from '../queue/order-queue.service';
import { OrderSettingsService } from './order-settings.service';

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
  /** accepted: restoran ETA'ni o'zgartirishi mumkin */
  eta?: { min: number; max: number };
  /** awaiting_payment (qayta urinish): yangi to'lov muddati */
  paymentExpiresAt?: Date;
}

export type Effect =
  | { type: 'status_changed'; from: OrderStatusName | null; to: OrderStatusName }
  | { type: 'placed' }
  | { type: 'payment_window'; expiresAt: Date }
  | { type: 'refund' };

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
  ) {}

  async transitionInTx(tx: Prisma.TransactionClient, input: TransitionInput): Promise<TransitionResult> {
    const order = await tx.customer_order.findUnique({ where: { id: input.orderId } });
    if (!order) throw new OrderNotFoundError(input.orderId);

    const from = order.status as OrderStatusName;
    const check = checkTransition(from, input.to, input.actor, order.fulfillment as FulfillmentName);
    if (!check.ok) throw new InvalidTransitionError(from, input.to, check.reason);

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
        if (input.eta) {
          data.eta_min = input.eta.min;
          data.eta_max = input.eta.max;
        }
        break;
      case 'completed':
        data.completed_at = now;
        break;
      case 'payment_failed':
        data.payment_status = 'failed';
        break;
      case 'awaiting_payment':
        data.payment_status = 'pending';
        data.payment_expires_at = input.paymentExpiresAt ?? null;
        if (input.paymentExpiresAt) effects.push({ type: 'payment_window', expiresAt: input.paymentExpiresAt });
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
        break;
    }

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

    const fresh = await tx.customer_order.findUniqueOrThrow({ where: { id: order.id } });
    return { order: fresh, from, effects };
  }

  /** Alohida tranzaksiyada o'tkazadi; versiya to'qnashuvida qayta o'qib urinadi. */
  async transition(input: TransitionInput): Promise<TransitionResult> {
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await this.prisma.$transaction((tx) => this.transitionInTx(tx, input));
        this.dispatchEffects(result.order, result.effects);
        return result;
      } catch (e) {
        if (e instanceof VersionConflictError && attempt < 3) continue;
        if (e instanceof VersionConflictError) {
          // Qayta o'qiganda holat o'zgargan: eng ishonchli javob — endi o'tish ruxsat etilmasligi.
          const now = await this.prisma.customer_order.findUnique({ where: { id: input.orderId }, select: { status: true, fulfillment: true } });
          if (!now) throw new OrderNotFoundError(input.orderId);
          const check = checkTransition(now.status as OrderStatusName, input.to, input.actor, now.fulfillment as FulfillmentName);
          throw new InvalidTransitionError(now.status as OrderStatusName, input.to, check.ok ? 'not_allowed' : check.reason);
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
            const notified = await this.restaurant.notifyNewOrder(order.id);
            if (!notified) this.logger.warn(`Buyurtma ${order.number}: restoranga Telegram xabari yuborilmadi (eskalatsiya baribir ishlaydi)`);
            const s = await this.settings.get(order.organization_id);
            await this.queues.scheduleAcceptanceEscalation(order.id, s.acceptanceTimeoutSeconds);
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
        }
      } catch (e: any) {
        this.logger.error(`Effect ${effect.type} (order ${order.number}) failed: ${e?.message ?? e}`);
      }
    }
  }
}
