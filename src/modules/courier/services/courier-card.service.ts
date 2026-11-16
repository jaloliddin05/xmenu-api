import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { OrderSettingsService } from 'src/modules/order/services/order-settings.service';
import { doorPaymentMethods } from 'src/modules/order/domain/delivery-payment';
import {
  TelegramApiError,
  TelegramClient,
  telegramErrorText,
} from 'src/modules/telegram/telegram-client';
import {
  TelegramBotService,
  type TenantBot,
} from 'src/modules/telegram/telegram-bot.service';
import type { OrderStatusName } from 'src/modules/order/domain/order-state-machine';
import {
  CourierCardAddress,
  CourierCardOrder,
  renderCourierCard,
} from '../domain/courier-card';
import { COURIER_TEXTS, courierLang } from '../domain/courier-texts';

const ORDER_SELECT = {
  id: true,
  number: true,
  organization_id: true,
  status: true,
  courier_id: true,
  door_problem: true,
  door_problem_reason: true,
  phone: true,
  comment: true,
  address_snapshot: true,
  total: true,
  currency: true,
  payment_method: true,
  cash_change_from: true,
  branch_id: true,
  branch: { select: { id: true, title: true, address: true } },
  customer: { select: { name: true } },
  items: {
    orderBy: { position: 'asc' },
    select: { name: true, quantity: true },
  },
} as const;

/** Telegram refuses to edit a message that did not change: that is success for us. */
const notModified = (e: unknown) =>
  e instanceof TelegramApiError && /not modified/i.test(e.description);

/**
 * The order card in a courier's chat (docs/DELIVERY.md, "Бот курьера"): sent once, then edited on every
 * change. When the old message cannot be edited any more (deleted, older than 48 hours) a new card is sent.
 * Telegram failures are logged with the order id only, never the guest's data or the bot token.
 */
@Injectable()
export class CourierCardService {
  private readonly logger = new Logger('CourierCard');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bots: TelegramBotService,
    private readonly telegram: TelegramClient,
    private readonly settings: OrderSettingsService,
  ) {}

  /** Rebuild the card of this order in this courier's chat (queue job; also called directly by the bot). */
  async refresh(
    orderId: string,
    courierId: string,
    opts: { refuseMenu?: boolean; resend?: boolean } = {},
  ): Promise<void> {
    const [order, courier, card] = await Promise.all([
      this.prisma.customer_order.findUnique({
        where: { id: orderId },
        select: ORDER_SELECT,
      }),
      this.prisma.courier.findUnique({ where: { id: courierId } }),
      this.prisma.courier_card.findUnique({
        where: {
          order_id_courier_id: { order_id: orderId, courier_id: courierId },
        },
      }),
    ]);
    if (!order || !courier?.telegram_chat_id) return;
    if (order.organization_id !== courier.organization_id) return;
    const bot = await this.bots.forTenant(order.organization_id);
    if (!bot) return;

    const readyFromBranch =
      order.courier_id === courierId && order.status === 'ready'
        ? await this.prisma.customer_order.count({
            where: {
              courier_id: courierId,
              status: 'ready',
              branch_id: order.branch_id,
            },
          })
        : 0;
    const lang = courierLang(courier.language_code);
    const doorMethods = doorPaymentMethods(
      await this.settings.get(order.organization_id),
    );
    const rendered = renderCourierCard(toCardOrder(order), {
      courierId,
      lang,
      readyFromBranch,
      refuseMenu: opts.refuseMenu,
      doorMethods,
    });

    // A finished card that was never sent stays unsent: nothing to tell the courier
    if (!card && rendered.final) return;

    const markup = rendered.keyboard ?? { inline_keyboard: [] };
    if (card && !opts.resend) {
      try {
        await this.telegram.call(bot.token, 'editMessageText', {
          chat_id: card.chat_id,
          message_id: card.message_id,
          text: rendered.text,
          reply_markup: markup,
          link_preview_options: { is_disabled: true },
        });
        if (rendered.final && order.courier_id !== courierId)
          await this.say(
            bot,
            card.chat_id,
            COURIER_TEXTS[lang].unassigned(order.number),
          );
        return;
      } catch (e) {
        if (notModified(e)) return;
        if (!(e instanceof TelegramApiError) || e.errorCode !== 400) throw e;
        // The message is gone or too old to edit: send a new card below
        this.logger.warn(
          `Card of order ${order.number} could not be edited, sending a new one: ${telegramErrorText(e)}`,
        );
      }
    }

    const sent = await this.telegram.call<{ message_id: number }>(
      bot.token,
      'sendMessage',
      {
        chat_id: courier.telegram_chat_id,
        text: rendered.text,
        reply_markup: markup,
        link_preview_options: { is_disabled: true },
      },
    );
    await this.prisma.courier_card.upsert({
      where: {
        order_id_courier_id: { order_id: orderId, courier_id: courierId },
      },
      create: {
        order_id: orderId,
        courier_id: courierId,
        chat_id: courier.telegram_chat_id,
        message_id: sent.message_id,
      },
      update: {
        chat_id: courier.telegram_chat_id,
        message_id: sent.message_id,
      },
    });
  }

  /** Plain message to a courier's chat (shift answers, access off). */
  async say(
    bot: TenantBot,
    chatId: string,
    text: string,
    replyMarkup?: Record<string, unknown>,
  ): Promise<void> {
    await this.telegram.call(bot.token, 'sendMessage', {
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }
}

type OrderRow = {
  id: string;
  number: number;
  status: string;
  courier_id: string | null;
  door_problem: 'no_answer' | 'refused' | null;
  door_problem_reason: string | null;
  phone: string;
  comment: string | null;
  address_snapshot: unknown;
  total: number;
  currency: string;
  payment_method: string;
  cash_change_from: number | null;
  branch: { id: string; title: string; address: string };
  customer: { name: string | null } | null;
  items: { name: string; quantity: number }[];
};

export function toCardOrder(o: OrderRow): CourierCardOrder {
  return {
    id: o.id,
    number: o.number,
    status: o.status as OrderStatusName,
    courierId: o.courier_id,
    doorProblem: o.door_problem,
    doorProblemReason: o.door_problem_reason,
    branch: o.branch,
    guestName: o.customer?.name ?? null,
    phone: o.phone,
    address: (o.address_snapshot as CourierCardAddress | null) ?? null,
    comment: o.comment,
    items: o.items,
    total: o.total,
    currency: o.currency,
    paymentMethod: o.payment_method,
    cashChangeFrom: o.cash_change_from,
  };
}
