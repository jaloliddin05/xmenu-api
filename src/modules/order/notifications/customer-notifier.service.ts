import { Injectable, Logger } from '@nestjs/common';
import { errorMessage } from 'src/infra/helper/error-text';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { TelegramBotService } from 'src/modules/telegram/telegram-bot.service';
import type { TenantBot } from 'src/modules/telegram/telegram-bot.service';
import {
  TelegramClient,
  telegramErrorText,
} from 'src/modules/telegram/telegram-client';
import { OrderStatusName } from '../domain/order-state-machine';
import { OrderQueueService } from '../queue/order-queue.service';
import { customerLangFor } from './customer-language';
import { CUSTOMER_TEXTS } from './customer-messages';
import {
  guestTarget,
  sendFailure,
  type GuestUnreachableReason,
} from './guest-notification';
import { buildCustomerText } from './order-messages';

export interface GuestNotificationJob {
  orderId: string;
  text: string;
}

/** Thrown by deliver() for a temporary failure: the queue retries the job. */
export class GuestNotificationRetry extends Error {}

/**
 * Notifications to the guest about their order (status, refund), rules in guest-notification.ts:
 * Mini App orders only, from the venue bot that opened the Mini App. The text is built when the
 * event happens (in the guest's language) and sent from the queue with retries; with
 * ORDER_QUEUES=off it is sent at once, without retries. Undelivered: logged with the order id and
 * marked on the customer (telegram_unreachable_*).
 */
@Injectable()
export class CustomerNotifierService {
  private readonly logger = new Logger('GuestNotification');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bots: TelegramBotService,
    private readonly telegram: TelegramClient,
    private readonly queues: OrderQueueService,
  ) {}

  async notifyStatus(
    orderId: string,
    from: OrderStatusName | null,
  ): Promise<void> {
    const order = await this.prisma.customer_order.findUnique({
      where: { id: orderId },
      select: {
        number: true,
        status: true,
        payment_method: true,
        payment_status: true,
        cancelled_by: true,
        organization_id: true,
        channel: true,
        customer: { select: { language: true } },
      },
    });
    if (!order || order.channel !== 'miniapp') return;

    const lang = await customerLangFor(
      this.prisma,
      order.organization_id,
      order.customer.language,
    );
    const text = buildCustomerText(order, from, lang);
    if (text) await this.dispatch({ orderId, text });
  }

  async notifyRefunded(orderId: string): Promise<void> {
    const order = await this.prisma.customer_order.findUnique({
      where: { id: orderId },
      select: {
        number: true,
        organization_id: true,
        channel: true,
        customer: { select: { language: true } },
      },
    });
    if (!order || order.channel !== 'miniapp') return;

    const lang = await customerLangFor(
      this.prisma,
      order.organization_id,
      order.customer.language,
    );
    await this.dispatch({
      orderId,
      text: CUSTOMER_TEXTS[lang].refunded(order.number),
    });
  }

  private async dispatch(job: GuestNotificationJob): Promise<void> {
    if (await this.queues.enqueueGuestNotification(job)) return;
    // No queue (ORDER_QUEUES=off) or it failed (already logged): one attempt now
    await this.deliver(job, true);
  }

  /**
   * One attempt. Throws GuestNotificationRetry on a temporary failure unless `lastAttempt`; every
   * other outcome is final and logged.
   */
  async deliver(
    job: GuestNotificationJob,
    lastAttempt: boolean,
  ): Promise<void> {
    const order = await this.prisma.customer_order.findUnique({
      where: { id: job.orderId },
      select: {
        organization_id: true,
        customer_id: true,
        channel: true,
        guest_telegram_id: true,
        guest_telegram_bot_id: true,
      },
    });
    if (!order) {
      this.logger.warn(`Order ${job.orderId}: gone, notification dropped`);
      return;
    }

    let bot: TenantBot | null = null;
    try {
      bot = await this.bots.forTenant(order.organization_id);
    } catch (e) {
      // The token cannot be decrypted (platform_misconfigured): for the guest the bot is gone
      this.logger.error(
        `Order ${job.orderId}: venue bot unusable: ${telegramErrorText(e)}`,
      );
    }

    const target = guestTarget(order, bot);
    if (target.kind === 'none') return;
    if (target.kind === 'unreachable')
      return this.unreachable(job, order.customer_id, target.reason);

    try {
      await this.telegram.call(bot!.token, 'sendMessage', {
        chat_id: target.chatId,
        text: job.text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (e) {
      const failure = sendFailure(e);
      if (failure.kind === 'final')
        return this.unreachable(job, order.customer_id, failure.reason, e);
      if (!lastAttempt) {
        this.logger.warn(
          `Order ${job.orderId}: notification failed, will retry: ${telegramErrorText(e)}`,
        );
        throw new GuestNotificationRetry();
      }
      return this.unreachable(job, order.customer_id, 'retries_exhausted', e);
    }

    await this.prisma.customer.updateMany({
      where: { id: order.customer_id, telegram_unreachable_at: { not: null } },
      data: {
        telegram_unreachable_at: null,
        telegram_unreachable_reason: null,
      },
    });
  }

  private async unreachable(
    job: GuestNotificationJob,
    customerId: string,
    reason: GuestUnreachableReason,
    sendError?: unknown,
  ): Promise<void> {
    const line = `Order ${job.orderId}: guest notification not delivered: ${reason}`;
    const serious = reason === 'retries_exhausted' || reason === 'rejected';
    if (sendError === undefined) {
      if (serious) this.logger.error(line);
      else this.logger.warn(line);
    } else if (serious)
      this.logger.error(`${line} (${telegramErrorText(sendError)})`);
    else this.logger.warn(`${line} (${telegramErrorText(sendError)})`);
    try {
      await this.prisma.customer.update({
        where: { id: customerId },
        data: {
          telegram_unreachable_at: new Date(),
          telegram_unreachable_reason: reason,
        },
      });
    } catch (e) {
      this.logger.error(
        `Order ${job.orderId}: cannot mark the guest unreachable: ${errorMessage(e)}`,
      );
    }
  }
}
