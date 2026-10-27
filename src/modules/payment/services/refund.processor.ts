import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { bullConnection } from 'src/infra/redis/bull-connection';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { OpsNotifierService } from 'src/modules/order/notifications/ops-notifier.service';
import { REFUND_QUEUE } from 'src/modules/order/queue/order-queue.service';
import { TelegramApiService } from 'src/modules/order/services/telegram-api.service';
import { clickReversePayment } from './click-api';
import { PaymentConfigService } from './payment-config.service';

/**
 * Bekor qilingan, lekin to'langan buyurtmalar uchun pulni qaytarish
 * (order.payment_status = refund_pending).
 *
 *  Click — Merchant API orqali avtomatik qaytariladi (xato bo'lsa BullMQ qayta
 *          urinadi: 5 marta, eksponensial; oxirgisida ops'ga signal).
 *  Payme — Merchant API'da merchant pulni o'zi qaytara OLMAYDI (qaytarish Payme
 *          tomonidan CancelTransaction orqali boshlanadi). Shuning uchun ops'ga
 *          "qo'lda qaytaring" signali ketadi va buyurtma refund_pending'da qoladi;
 *          Payme CancelTransaction yuborganda holat 'refunded' bo'ladi.
 */
@Injectable()
export class RefundProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Refund');
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configs: PaymentConfigService,
    private readonly ops: OpsNotifierService,
    private readonly telegram: TelegramApiService,
  ) {}

  onModuleInit() {
    if (process.env.ORDER_QUEUES === 'off') return;
    this.worker = new Worker(REFUND_QUEUE, (job) => this.process(job), { connection: bullConnection(), concurrency: 2 });
    this.worker.on('failed', (job, err) => {
      const exhausted = job && job.attemptsMade >= (job.opts.attempts ?? 1);
      this.logger.error(`Refund job ${job?.data?.orderId} failed (${job?.attemptsMade}): ${err.message}`);
      if (exhausted) void this.ops.alert(`Не удалось вернуть деньги по заказу ${job?.data?.orderId}: ${err.message}. Нужен ручной возврат.`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  async process(job: Job<{ orderId: string }>): Promise<void> {
    const order = await this.prisma.customer_order.findUnique({
      where: { id: job.data.orderId },
      include: { payments: { where: { status: 'paid' } }, customer: { select: { telegram_id: true } } },
    });
    if (!order || order.payment_status !== 'refund_pending') return; // allaqachon hal bo'lgan

    let manual = false;
    for (const payment of order.payments) {
      if (payment.provider === 'click') {
        const cfg = await this.configs.getClick(order.organization_id);
        if (!cfg || !payment.provider_payment_id) throw new Error('Click sozlamasi yoki click_paydoc_id yo\'q');
        await clickReversePayment(cfg, payment.provider_payment_id);
        await this.prisma.order_payment.update({ where: { id: payment.id }, data: { status: 'refunded', refunded_at: new Date() } });
      } else {
        manual = true;
      }
    }

    if (manual) {
      await this.ops.alert(`Заказ №${order.number} (${order.total} сум) отменён после оплаты через Payme — верните деньги вручную в кабинете Payme.`);
      return;
    }

    await this.prisma.customer_order.update({ where: { id: order.id }, data: { payment_status: 'refunded' } });
    if (order.customer.telegram_id) {
      await this.telegram.sendMessage(order.customer.telegram_id, `💸 Деньги за заказ №${order.number} возвращены`);
    }
  }
}
