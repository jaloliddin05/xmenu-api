import { Injectable, Logger } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { TelegramApiService } from '../services/telegram-api.service';
import type { DeliveryTimerKind } from '../domain/delivery-timers';
import {
  buildDeliveryAlertText,
  buildDeliveryTimerText,
  buildPosAlertText,
  buildRestaurantKeyboard,
  buildRestaurantText,
  POS_MENU_IMPORT_TEXT,
  POS_RECONNECT_TEXT,
  PosAlert,
} from './order-messages';
import type { OrderWithItems } from '../services/order-view';
import { FINAL_STATUSES } from '../domain/order-state-machine';
import { isPosControlled, kitchenModeOf } from '../domain/kitchen';

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
  pos_order: { select: { state: true } },
} as const;

/** A reply to the order card that still goes out when the card is gone (the chat moved to a supergroup). */
const replyTo = (messageId: number) => ({
  reply_to_message_id: messageId,
  allow_sending_without_reply: true,
});

/**
 * Restoran Telegram guruhiga buyurtma xabari. Tugmalar (Принять / Отклонить ...)
 * xabarni TAHRIRLAYDI, yangisini yubormaydi — guruh to'lib ketmasligi uchun.
 * Xabar id'si buyurtmada saqlanadi (tg_chat_id / tg_message_id).
 *
 * Every message to a branch chat goes through sendToChat / editInChat: a group that became a supergroup answers
 * with its new id (migrate_to_chat_id), the binding moves there (migrateChat) and the message is sent once more.
 */
@Injectable()
export class RestaurantNotifierService {
  private readonly logger = new Logger('RestaurantNotifier');

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramApiService,
  ) {}

  /**
   * Buttons of the order card: the kitchen step follows the venue's kitchen queue, and an order iiko leads has no
   * kitchen button (order/domain/kitchen.ts).
   */
  private async keyboard(order: {
    id: string;
    status: OrderStatus;
    fulfillment: 'delivery' | 'pickup';
    organization_id: string;
    pos_order: { state: string } | null;
  }) {
    const [settings, integration] = await Promise.all([
      this.prisma.organization_order_settings.findUnique({
        where: { organization_id: order.organization_id },
        select: { track_preparation: true },
      }),
      this.prisma.pos_integration.findUnique({
        where: { organization_id: order.organization_id },
        select: { status: true, courier_mode: true },
      }),
    ]);
    const mode = kitchenModeOf(
      settings?.track_preparation ?? false,
      integration,
    );
    return buildRestaurantKeyboard(order, {
      trackPreparation: mode.trackPreparation,
      posControlled: isPosControlled(mode.posLive, order.pos_order?.state),
    });
  }

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

    const sent = await this.sendToChat(
      chatId,
      buildRestaurantText(order as OrderWithItems),
      {
        reply_markup: await this.keyboard(order),
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
    const outcome = await this.telegram.editMessageTextWithOutcome(
      order.tg_chat_id,
      order.tg_message_id,
      buildRestaurantText(order as OrderWithItems),
      await this.keyboard(order),
    );
    // The chat became a supergroup: migrateChat posts the cards of unfinished orders there afresh
    if (outcome.migrateToChatId)
      await this.migrateChat(order.tg_chat_id, outcome.migrateToChatId);
  }

  /**
   * The group of a branch became a supergroup (Telegram gives it a new id): every branch bound to the old id
   * moves to the new one, and every unfinished order whose card was in the old chat gets a new card there (the
   * old card cannot be edited any more). Idempotent: a second call finds nothing bound to the old id. Both the
   * service messages of the migration (webhook) and an error answer to a send (sendToChat) call it.
   */
  async migrateChat(oldChatId: string, newChatId: string): Promise<void> {
    if (!oldChatId || !newChatId || oldChatId === newChatId) return;
    const branches = await this.prisma.branch.updateMany({
      where: { telegram_chat_id: oldChatId },
      data: { telegram_chat_id: newChatId },
    });
    const orders = await this.prisma.customer_order.findMany({
      where: {
        tg_chat_id: oldChatId,
        status: { notIn: [...FINAL_STATUSES] },
      },
      select: { id: true },
    });
    let reposted = 0;
    for (const { id } of orders) {
      // Claim the order, so two calls at once never post two cards
      const claimed = await this.prisma.customer_order.updateMany({
        where: { id, tg_chat_id: oldChatId },
        data: { tg_chat_id: newChatId, tg_message_id: null },
      });
      if (claimed.count === 0) continue;
      const order = await this.load(id);
      if (!order) continue;
      const sent = await this.telegram.sendMessage(
        newChatId,
        buildRestaurantText(order as OrderWithItems),
        { reply_markup: await this.keyboard(order) },
      );
      if (!sent) continue;
      await this.prisma.customer_order.update({
        where: { id },
        data: { tg_message_id: sent.message_id },
      });
      reposted++;
    }
    if (branches.count > 0 || reposted > 0)
      this.logger.log(
        `chat ${oldChatId} became ${newChatId}: ${branches.count} branches moved, ${reposted} cards posted again`,
      );
  }

  /** sendMessage to a branch chat; after a move to a supergroup the binding follows and the message is sent once more. */
  private async sendToChat(
    chatId: string,
    text: string,
    extra: Record<string, unknown> = {},
  ) {
    const outcome = await this.telegram.sendMessageWithOutcome(
      chatId,
      text,
      extra,
    );
    if (!outcome.migrateToChatId) return outcome.result;
    await this.migrateChat(chatId, outcome.migrateToChatId);
    return this.telegram.sendMessage(outcome.migrateToChatId, text, extra);
  }

  /** Eskalatsiya: tasdiqlanmagan buyurtma haqida eslatma (asl xabarga javob sifatida). */
  async ping(orderId: string, minutesWaiting: number): Promise<void> {
    const order = await this.load(orderId);
    if (!order?.tg_chat_id) return;
    await this.sendToChat(
      order.tg_chat_id,
      `⏰ <b>Заказ №${order.number} ждёт подтверждения уже ${minutesWaiting} мин!</b>\nПримите или отклоните его кнопками выше.`,
      order.tg_message_id ? replyTo(order.tg_message_id) : {},
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

  /** An order of a venue with iiko: a message to the branch chat (docs/IIKO.md, "Ошибки и сбои"). */
  alertPos(orderId: string, alert: PosAlert): Promise<void> {
    return this.alertDelivery(orderId, (number) =>
      buildPosAlertText(number, alert),
    );
  }

  /** The venue's iiko key stopped working: one message to every branch chat of the venue. */
  alertPosReconnect(organizationId: string): Promise<void> {
    return this.alertVenue(organizationId, POS_RECONNECT_TEXT);
  }

  /** The menu import from iiko failed: one message to every branch chat of the venue. */
  alertPosMenuImport(organizationId: string): Promise<void> {
    return this.alertVenue(organizationId, POS_MENU_IMPORT_TEXT);
  }

  private async alertVenue(organizationId: string, text: string) {
    const branches = await this.prisma.branch.findMany({
      where: {
        organization_id: organizationId,
        telegram_chat_id: { not: null },
      },
      select: { telegram_chat_id: true },
    });
    for (const chatId of new Set(branches.map((b) => b.telegram_chat_id!)))
      await this.sendToChat(chatId, text);
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
    await this.sendToChat(
      chatId,
      text(order.number, courierName),
      order.tg_message_id && order.tg_chat_id
        ? replyTo(order.tg_message_id)
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
