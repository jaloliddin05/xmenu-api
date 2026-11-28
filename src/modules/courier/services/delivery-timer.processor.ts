import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { errorMessage } from 'src/infra/helper/error-text';
import { bullConnection } from 'src/infra/redis/bull-connection';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { timerStillDue } from 'src/modules/order/domain/delivery-timers';
import { RestaurantNotifierService } from 'src/modules/order/notifications/restaurant-notifier.service';
import {
  DELIVERY_TIMER_QUEUE,
  DeliveryTimerJob,
  OrderQueueService,
} from 'src/modules/order/queue/order-queue.service';
import { TelegramBotService } from 'src/modules/telegram/telegram-bot.service';
import { telegramErrorText } from 'src/modules/telegram/telegram-client';
import { COURIER_TEXTS, courierLang } from '../domain/courier-texts';
import { CourierCardService } from './courier-card.service';
import { LiveEventBus } from 'src/modules/live/live-event-bus';

/** The board's attention mark a timer brings (order/domain/order-board.ts, `attention`). */
export const TIMER_ATTENTION = {
  pickup: 'not_picked_up',
  road: 'long_on_the_way',
  door: 'at_door',
} as const;

/**
 * Delivery timers ran out (order/domain/delivery-timers.ts): "picked up" not pressed after "ready" (the
 * courier and the branch chat), on the way too long (the branch chat), the wait at the door after "no answer"
 * is over (the branch chat decides; the courier is told). Nothing is sent when the order has left the status
 * episode the job was scheduled for.
 */
@Injectable()
export class DeliveryTimerProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('DeliveryTimers');
  private worker?: Worker<DeliveryTimerJob>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: OrderQueueService,
    private readonly restaurant: RestaurantNotifierService,
    private readonly bots: TelegramBotService,
    private readonly cards: CourierCardService,
    @Optional() private readonly live?: LiveEventBus,
  ) {}

  onModuleInit() {
    if (!this.queues.enabled) return;
    this.worker = new Worker<DeliveryTimerJob>(
      DELIVERY_TIMER_QUEUE,
      (job: Job<DeliveryTimerJob>) => this.fire(job.data),
      { connection: bullConnection(), concurrency: 5 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(
        `Timer ${job?.data.kind ?? '?'} (order ${job?.data.orderId ?? '?'}) failed: ${errorMessage(err)}`,
      ),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  /** true when the reminder went out, false when the order moved on meanwhile. */
  async fire(job: DeliveryTimerJob): Promise<boolean> {
    const order = await this.prisma.customer_order.findUnique({
      where: { id: job.orderId },
      select: {
        id: true,
        number: true,
        organization_id: true,
        status: true,
        door_problem: true,
        ready_at: true,
        picked_up_at: true,
        door_problem_at: true,
        courier_id: true,
        branch_id: true,
        customer_id: true,
        version: true,
      },
    });
    if (!order || !timerStillDue(job.kind, job.since, order)) return false;

    // The mark appears by time, not by a change: without this event an open board would not show it
    await this.live?.order(order, 'order.attention', {
      code: TIMER_ATTENTION[job.kind],
    });

    await this.restaurant.alertDeliveryTimer(order.id, job.kind);
    if (job.kind !== 'road' && order.courier_id)
      await this.tellCourier(order, job.kind);
    return true;
  }

  private async tellCourier(
    order: {
      number: number;
      organization_id: string;
      courier_id: string | null;
    },
    kind: 'pickup' | 'door',
  ) {
    const courier = await this.prisma.courier.findUnique({
      where: { id: order.courier_id! },
    });
    if (!courier?.is_active || !courier.telegram_chat_id) return;
    const bot = await this.bots.forTenant(order.organization_id);
    if (!bot) return;
    const t = COURIER_TEXTS[courierLang(courier.language_code)];
    const text =
      kind === 'pickup'
        ? t.pickupReminder(order.number)
        : t.doorWaitOver(order.number);
    try {
      await this.cards.say(bot, courier.telegram_chat_id, text);
    } catch (e) {
      // The branch chat already got the reminder; the courier misses this one
      this.logger.warn(
        `Courier of order ${order.number} was not reminded: ${telegramErrorText(e)}`,
      );
    }
  }
}
