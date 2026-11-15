import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { TelegramApiService } from '../services/telegram-api.service';
import type { DeliveryTimerKind } from '../domain/delivery-timers';
import {
  buildDeliveryAlertText,
  buildDeliveryTimerText,
  buildRestaurantKeyboard,
  buildRestaurantText,
} from './order-messages';
import type { OrderWithItems } from '../services/order-view';

const include = {
  items: { include: { options: true } },
  branch: {
    select: {
      id: true,
      title: true,
      address: true,
      telegram_chat_id: true,
      phone: true,
    },
  },
} as const;

/**
 * Restoran Telegram guruhiga buyurtma xabari. Tugmalar (Принять / Отклонить ...)
 * xabarni TAHRIRLAYDI, yangisini yubormaydi — guruh to'lib ketmasligi uchun.
 * Xabar id'si buyurtmada saqlanadi (tg_chat_id / tg_message_id).
 */
@Injectable()
export class RestaurantNotifierService {
  private readonly logger = new Logger('RestaurantNotifier');

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramApiService,
  ) {}

  private load(orderId: string) {
    return this.prisma.customer_order.findUnique({
      where: { id: orderId },
      include,
    });
  }

  /** Yangi buyurtma: guruhga xabar. chat sozlanmagan bo'lsa false (eskalatsiya SMS'ga o'tadi). */
  async notifyNewOrder(orderId: string): Promise<boolean> {
    const order = await this.load(orderId);
    const chatId = order?.branch.telegram_chat_id;
    if (!order || !chatId) {
      if (order)
        this.logger.warn(
          `Filial ${order.branch.id} uchun telegram_chat_id yo'q — buyurtma ${order.number} xabarsiz qoldi`,
        );
      return false;
    }

    const sent = await this.telegram.sendMessage(
      chatId,
      buildRestaurantText(order as OrderWithItems),
      {
        reply_markup: buildRestaurantKeyboard(order),
      },
    );
    if (!sent) return false;

    await this.prisma.customer_order.update({
      where: { id: orderId },
      data: {
        tg_chat_id: String(sent.chat.id),
        tg_message_id: sent.message_id,
      },
    });
    return true;
  }

  /** Holat o'zgarganda mavjud xabarni yangilaydi (matn + mos tugmalar). */
  async refreshMessage(orderId: string): Promise<void> {
    const order = await this.load(orderId);
    if (!order?.tg_chat_id || !order.tg_message_id) return;
    await this.telegram.editMessageText(
      order.tg_chat_id,
      order.tg_message_id,
      buildRestaurantText(order as OrderWithItems),
      buildRestaurantKeyboard(order),
    );
  }

  /** Eskalatsiya: tasdiqlanmagan buyurtma haqida eslatma (asl xabarga javob sifatida). */
  async ping(orderId: string, minutesWaiting: number): Promise<void> {
    const order = await this.load(orderId);
    if (!order?.tg_chat_id) return;
    await this.telegram.sendMessage(
      order.tg_chat_id,
      `⏰ <b>Заказ №${order.number} ждёт подтверждения уже ${minutesWaiting} мин!</b>\nПримите или отклоните его кнопками выше.`,
      order.tg_message_id ? { reply_to_message_id: order.tg_message_id } : {},
    );
  }

  /**
   * Urgent message about a delivery problem ("no answer", "refused", "cannot deliver"), as a reply to the order
   * message in the branch chat. Without a chat the operator sees it in the dashboard only.
   */
  alertDeliveryProblem(
    orderId: string,
    kind: 'no_answer' | 'refused' | 'cannot_deliver',
  ): Promise<void> {
    return this.alertDelivery(orderId, (number, courierName) =>
      buildDeliveryAlertText(number, kind, courierName),
    );
  }

  /** A delivery timer ran out (docs/DELIVERY.md, "Напоминания"): a message to the branch chat. */
  alertDeliveryTimer(orderId: string, kind: DeliveryTimerKind): Promise<void> {
    return this.alertDelivery(orderId, (number, courierName) =>
      buildDeliveryTimerText(number, kind, courierName),
    );
  }

  private async alertDelivery(
    orderId: string,
    text: (number: number, courierName: string | null) => string,
  ): Promise<void> {
    const order = await this.prisma.customer_order.findUnique({
      where: { id: orderId },
      select: {
        number: true,
        tg_chat_id: true,
        tg_message_id: true,
        branch: { select: { telegram_chat_id: true } },
        courier: { select: { name: true } },
        events: {
          where: { actor: 'courier' },
          orderBy: { id: 'desc' },
          take: 1,
          select: { actor_id: true },
        },
      },
    });
    const chatId = order?.tg_chat_id ?? order?.branch.telegram_chat_id;
    if (!order || !chatId) return;
    // After "cannot deliver" the order has no courier any more: name the one who pressed it
    let courierName = order.courier?.name ?? null;
    const lastCourierId = order.events[0]?.actor_id;
    if (!courierName && lastCourierId) {
      const c = await this.prisma.courier.findUnique({
        where: { id: lastCourierId },
        select: { name: true },
      });
      courierName = c?.name ?? null;
    }
    await this.telegram.sendMessage(
      chatId,
      text(order.number, courierName),
      order.tg_message_id && order.tg_chat_id
        ? { reply_to_message_id: order.tg_message_id }
        : {},
    );
  }

  /** Filial telefoni (SMS eskalatsiyasi uchun). */
  async branchPhone(
    orderId: string,
  ): Promise<{ phone: string | null; number: number } | null> {
    const order = await this.load(orderId);
    return order ? { phone: order.branch.phone, number: order.number } : null;
  }
}
