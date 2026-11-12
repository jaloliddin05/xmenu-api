import { errorMessage } from 'src/infra/helper/error-text';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { bullConnection } from 'src/infra/redis/bull-connection';

export const ESCALATION_QUEUE = 'order-escalation';
export const REFUND_QUEUE = 'order-refunds';
export const GUEST_NOTIFICATION_QUEUE = 'guest-notifications';
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
    ]);
  }
}
