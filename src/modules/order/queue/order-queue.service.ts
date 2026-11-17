import { errorMessage } from 'src/infra/helper/error-text';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { bullConnection } from 'src/infra/redis/bull-connection';
import {
  DELIVERY_TIMER_KINDS,
  DeliveryTimer,
  DeliveryTimerKind,
} from '../domain/delivery-timers';

export const ESCALATION_QUEUE = 'order-escalation';
export const REFUND_QUEUE = 'order-refunds';
export const GUEST_NOTIFICATION_QUEUE = 'guest-notifications';
/** Order cards in couriers' chats (worker: courier module, CourierCardProcessor). */
export const COURIER_CARD_QUEUE = 'courier-cards';
export interface CourierCardJob {
  orderId: string;
  courierId: string;
}
/** Delivery reminders and the door timer (worker: courier module, DeliveryTimerProcessor). */
export const DELIVERY_TIMER_QUEUE = 'delivery-timers';
export interface DeliveryTimerJob {
  orderId: string;
  kind: DeliveryTimerKind;
  /** Start of the status episode, ms (domain/delivery-timers.ts, timerStillDue) */
  since: number;
}
/**
 * Orders of venues with a POS (worker: pos module, PosOrderProcessor; docs/IIKO.md): `push` sends an
 * accepted order, `check` reads the result of the command, `delivered` passes "on the way" and
 * "delivered" of an own courier, `poll` asks the POS for the statuses of unfinished orders.
 */
export const POS_ORDER_QUEUE = 'pos-orders';
export type PosOrderJobName = 'push' | 'check' | 'delivered' | 'poll';
export interface PosOrderJob {
  orderId?: string;
  integrationId?: string;
  correlationId?: string;
  /** check: how many times the command was asked already */
  polls?: number;
}
const deliveryTimerJobId = (orderId: string, kind: DeliveryTimerKind) =>
  `dlv-${kind}-${orderId}`;
/** Temporary Telegram failures are retried: 10 s, 20 s, 40 s, 80 s after the first attempt. */
export const GUEST_NOTIFICATION_ATTEMPTS = 5;

/**
 * Eskalatsiya zanjiri (restoran buyurtmani qabul qilmasa), vaqt — buyurtma
 * "pending_acceptance"ga o'tgan paytdan:
 *
 *    45s   Telegramda takroriy ogohlantirish
 *   120s   filial telefoniga SMS
 *   300s   avtomatik bekor + qaytarish (acceptance_timeout_seconds)
 *
 * There is no robocall step: it was dropped from the chain on purpose.
 *
 * Har bir job bajarilganda buyurtma holatini QAYTA o'qiydi: qabul qilingan /
 * bekor qilingan bo'lsa hech narsa qilmaydi — shuning uchun jobni o'chirish
 * shart emas va qayta ishga tushirish xavfsiz.
 */
export const ESCALATION_STEPS = [
  { name: 'ping', afterSeconds: 45 },
  { name: 'sms', afterSeconds: 120 },
] as const;

/**
 * Navbatlar. ORDER_QUEUES=off — Redis'siz lokal ishlab chiqish uchun: jobs
 * qo'yilmaydi (eskalatsiya va avto-bekor ishlamaydi; to'lov muddati lazy
 * tekshiruv orqali baribir ishlaydi — OrderService.get).
 */
@Injectable()
export class OrderQueueService implements OnModuleDestroy {
  private readonly logger = new Logger('OrderQueue');
  readonly enabled = process.env.ORDER_QUEUES !== 'off';
  private escalation?: Queue;
  private refunds?: Queue;
  private guestNotifications?: Queue;
  private courierCards?: Queue;
  private deliveryTimers?: Queue;
  private posOrders?: Queue<PosOrderJob>;

  private get escalationQueue(): Queue {
    return (this.escalation ??= new Queue(ESCALATION_QUEUE, {
      connection: bullConnection(),
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    }));
  }

  private get refundQueue(): Queue {
    return (this.refunds ??= new Queue(REFUND_QUEUE, {
      connection: bullConnection(),
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    }));
  }

  private get guestNotificationQueue(): Queue {
    return (this.guestNotifications ??= new Queue(GUEST_NOTIFICATION_QUEUE, {
      connection: bullConnection(),
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100,
        attempts: GUEST_NOTIFICATION_ATTEMPTS,
        backoff: { type: 'exponential', delay: 10_000 },
      },
    }));
  }

  private get courierCardQueue(): Queue {
    return (this.courierCards ??= new Queue(COURIER_CARD_QUEUE, {
      connection: bullConnection(),
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100,
        attempts: 5,
        backoff: { type: 'exponential', delay: 3000 },
      },
    }));
  }

  private get deliveryTimerQueue(): Queue {
    return (this.deliveryTimers ??= new Queue(DELIVERY_TIMER_QUEUE, {
      connection: bullConnection(),
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    }));
  }

  /** Shared with the pos module (PosOrderProcessor), which adds the follow-up jobs itself. */
  get posOrderQueue(): Queue<PosOrderJob> {
    return (this.posOrders ??= new Queue<PosOrderJob>(POS_ORDER_QUEUE, {
      connection: bullConnection(),
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100,
        // The handler counts the attempts of an order itself (pos_order.attempts); this one covers a crash
        attempts: 2,
        backoff: { type: 'fixed', delay: 10_000 },
      },
    }));
  }

  private async safe(label: string, fn: () => Promise<unknown>) {
    if (!this.enabled) return;
    try {
      await fn();
    } catch (e) {
      // Navbat ishlamasa buyurtma baribir saqlangan bo'lishi kerak.
      this.logger.error(`${label}: ${errorMessage(e)}`);
    }
  }

  /** Onlayn to'lov muddati tugaganda buyurtmani payment_failed ga o'tkazadi. */
  schedulePaymentExpiry(orderId: string, expiresAt: Date) {
    return this.safe('schedulePaymentExpiry', () =>
      this.escalationQueue.add(
        'payment-expiry',
        { orderId },
        {
          jobId: `pay-exp-${orderId}-${expiresAt.getTime()}`,
          delay: Math.max(0, expiresAt.getTime() - Date.now()),
        },
      ),
    );
  }

  scheduleAcceptanceEscalation(orderId: string, timeoutSeconds: number) {
    return this.safe('scheduleAcceptanceEscalation', async () => {
      for (const step of ESCALATION_STEPS) {
        if (step.afterSeconds >= timeoutSeconds) continue; // avto-bekordan keyin ma'nosiz
        await this.escalationQueue.add(
          `esc-${step.name}`,
          { orderId },
          {
            jobId: `esc-${orderId}-${step.name}`,
            delay: step.afterSeconds * 1000,
          },
        );
      }
      await this.escalationQueue.add(
        'esc-cancel',
        { orderId },
        { jobId: `esc-${orderId}-cancel`, delay: timeoutSeconds * 1000 },
      );
    });
  }

  enqueueRefund(orderId: string) {
    return this.safe('enqueueRefund', () =>
      this.refundQueue.add(
        'refund',
        { orderId },
        { jobId: `refund-${orderId}` },
      ),
    );
  }

  /**
   * Rebuild the order card in the courier's chat. The job reads the order when it runs, so the card always
   * shows the latest state; the order version in the job id keeps one job per change.
   */
  enqueueCourierCard(orderId: string, courierId: string, version: number) {
    return this.safe('enqueueCourierCard', () =>
      this.courierCardQueue.add(
        'card',
        { orderId, courierId } satisfies CourierCardJob,
        { jobId: `card-${orderId}-${courierId}-${version}` },
      ),
    );
  }

  /**
   * The order changed status: the pending delivery timers of the order are removed (that is how a reminder is
   * cancelled), and the timer of the new status, if any, is scheduled.
   */
  resetDeliveryTimers(orderId: string, next: DeliveryTimer | null) {
    return this.safe('resetDeliveryTimers', async () => {
      const queue = this.deliveryTimerQueue;
      for (const kind of DELIVERY_TIMER_KINDS)
        await queue.remove(deliveryTimerJobId(orderId, kind));
      if (!next) return;
      await queue.add(
        next.kind,
        {
          orderId,
          kind: next.kind,
          since: next.since.getTime(),
        } satisfies DeliveryTimerJob,
        {
          jobId: deliveryTimerJobId(orderId, next.kind),
          delay: Math.max(0, next.dueAt.getTime() - Date.now()),
        },
      );
    });
  }

  /**
   * An accepted order goes to the POS (`push`), or an own courier delivered an order the POS has
   * (`delivered`). Without queues (ORDER_QUEUES=off) nothing goes to the POS: the order stays queued.
   */
  enqueuePosOrder(name: 'push' | 'delivered', orderId: string) {
    if (!this.enabled)
      this.logger.warn(
        `ORDER_QUEUES=off: order ${orderId} is not passed to the POS (${name})`,
      );
    return this.safe('enqueuePosOrder', () =>
      this.posOrderQueue.add(
        name,
        { orderId },
        { jobId: `pos-${name}-${orderId}-0` },
      ),
    );
  }

  /** False when there is no queue (ORDER_QUEUES=off) or it failed (logged): the caller sends at once. */
  async enqueueGuestNotification(data: {
    orderId: string;
    text: string;
  }): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      await this.guestNotificationQueue.add('notify', data);
      return true;
    } catch (e) {
      this.logger.error(
        `enqueueGuestNotification (order ${data.orderId}): ${errorMessage(e)}`,
      );
      return false;
    }
  }

  async onModuleDestroy() {
    await Promise.all([
      this.escalation?.close(),
      this.refunds?.close(),
      this.guestNotifications?.close(),
      this.courierCards?.close(),
      this.deliveryTimers?.close(),
      this.posOrders?.close(),
    ]);
  }
}
