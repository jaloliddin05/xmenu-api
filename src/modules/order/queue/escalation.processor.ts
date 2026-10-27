import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { bullConnection } from 'src/infra/redis/bull-connection';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { SMS_PROVIDER } from 'src/modules/sms/providers/sms-provider.interface';
import type { SmsProvider } from 'src/modules/sms/providers/sms-provider.interface';
import { OpsNotifierService } from '../notifications/ops-notifier.service';
import { RestaurantNotifierService } from '../notifications/restaurant-notifier.service';
import { InvalidTransitionError, OrderTransitionService } from '../services/order-transition.service';
import { ESCALATION_QUEUE, ESCALATION_STEPS } from './order-queue.service';

/**
 * Eskalatsiya va to'lov muddati ishchisi. Job'lar OrderQueueService tomonidan
 * qo'yiladi; har biri buyurtmani qayta o'qiydi va faqat hali kutilayotgan
 * holatda ish qiladi (idempotent).
 */
@Injectable()
export class EscalationProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Escalation');
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: OrderTransitionService,
    private readonly restaurant: RestaurantNotifierService,
    private readonly ops: OpsNotifierService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  onModuleInit() {
    if (process.env.ORDER_QUEUES === 'off') {
      this.logger.warn('ORDER_QUEUES=off — eskalatsiya ishchisi ishga tushmadi');
      return;
    }
    this.worker = new Worker(ESCALATION_QUEUE, (job) => this.process(job), { connection: bullConnection(), concurrency: 5 });
    this.worker.on('failed', (job, err) => this.logger.error(`Job ${job?.name} (${job?.data?.orderId}) failed: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  async process(job: Job<{ orderId: string }>): Promise<void> {
    const { orderId } = job.data;
    const order = await this.prisma.customer_order.findUnique({
      where: { id: orderId },
      select: { id: true, number: true, status: true, payment_expires_at: true, placed_at: true },
    });
    if (!order) return;

    switch (job.name) {
      case 'payment-expiry':
        if (order.status === 'awaiting_payment' && order.payment_expires_at && order.payment_expires_at <= new Date()) {
          await this.safeTransition({ orderId, to: 'payment_failed', actor: 'system', note: 'expired' });
        }
        return;

      case 'esc-ping':
        if (order.status !== 'pending_acceptance') return;
        await this.restaurant.ping(orderId, Math.round(ESCALATION_STEPS[0].afterSeconds / 60) || 1);
        return;

      case 'esc-sms': {
        if (order.status !== 'pending_acceptance') return;
        const info = await this.restaurant.branchPhone(orderId);
        if (info?.phone) {
          await this.sms.send(info.phone, `Xmenu: buyurtma №${info.number} tasdiqlanishini kutmoqda! Telegram guruhini oching.`);
        } else {
          await this.ops.alert(`Заказ №${order.number}: нет подтверждения, у филиала нет телефона для SMS`);
        }
        return;
      }

      case 'esc-call':
        if (order.status !== 'pending_acceptance') return;
        // Robozvonok provayderi ulanmagan: jamoaga signal beramiz, 5 daqiqada avto-bekor baribir ishlaydi.
        await this.ops.alert(`Заказ №${order.number} не принят уже 3 мин (робозвонок не подключён) — свяжитесь с филиалом`);
        return;

      case 'esc-cancel':
        if (order.status !== 'pending_acceptance') return;
        await this.safeTransition({ orderId, to: 'cancelled', actor: 'system', reason: 'no_response' });
        return;

      default:
        this.logger.warn(`Noma'lum job: ${job.name}`);
    }
  }

  /** Poyga: restoran aynan shu soniyada qabul qilgan bo'lishi mumkin — bu xato emas. */
  private async safeTransition(input: Parameters<OrderTransitionService['transition']>[0]) {
    try {
      await this.transitions.transition(input);
    } catch (e) {
      if (e instanceof InvalidTransitionError) return;
      throw e;
    }
  }
}
