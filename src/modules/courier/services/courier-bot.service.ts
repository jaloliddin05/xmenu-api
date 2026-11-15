import { Injectable, Logger } from '@nestjs/common';
import type { courier } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  COURIER_HELD_STATUSES,
  OrderStatusName,
} from 'src/modules/order/domain/order-state-machine';
import {
  CourierNotAssignedError,
  InvalidTransitionError,
  OrderNotFoundError,
  OrderTransitionService,
  TransitionInput,
} from 'src/modules/order/services/order-transition.service';
import {
  TelegramClient,
  telegramErrorText,
} from 'src/modules/telegram/telegram-client';
import type { TenantBot } from 'src/modules/telegram/telegram-bot.service';
import { CourierAction, parseCourierAction } from '../domain/courier-card';
import {
  hashInviteToken,
  inviteTokenFromStart,
  inviteUsable,
} from '../domain/courier-invitation';
import {
  COURIER_TEXTS,
  CourierLang,
  CourierTexts,
  courierLang,
} from '../domain/courier-texts';
import { CourierCardService } from './courier-card.service';
import { CourierShiftService } from './courier-shift.service';

/** The parts of a Telegram update the courier bot reads. */
export interface CourierBotUpdate {
  message?: {
    chat?: { id: number; type?: string };
    from?: { id: number; is_bot?: boolean; language_code?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number; is_bot?: boolean; language_code?: string };
    message?: { chat?: { id: number } };
  };
}

type Answer = keyof Pick<
  CourierTexts,
  'done' | 'alreadyDone' | 'notYours' | 'notAvailable'
>;

/** Reply keyboard of a courier: shift buttons and "My orders". */
export function courierMenu(t: CourierTexts) {
  return {
    keyboard: [
      [{ text: t.startShift }, { text: t.endShift }],
      [{ text: t.myOrders }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/** The menu button pressed, in any of the three languages (a courier may switch Telegram's language). */
function menuCommand(text: string): 'start' | 'end' | 'orders' | null {
  for (const t of Object.values(COURIER_TEXTS)) {
    if (text === t.startShift) return 'start';
    if (text === t.endShift) return 'end';
    if (text === t.myOrders) return 'orders';
  }
  return null;
}

/**
 * The courier side of the venue bot (docs/DELIVERY.md, "Бот курьера"): the invitation (/start c_<token>), the
 * shift menu, "My orders" and the buttons on order cards. A button is accepted only from the active courier
 * assigned to that order; a repeated press changes nothing and answers "already marked". Updates that are not
 * a courier's go on to the guest phone check (TelegramVerificationService).
 */
@Injectable()
export class CourierBotService {
  private readonly logger = new Logger('CourierBot');

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramClient,
    private readonly transitions: OrderTransitionService,
    private readonly shifts: CourierShiftService,
    private readonly cards: CourierCardService,
  ) {}

  /** true: the update was the courier's and is handled. */
  async handleUpdate(
    bot: TenantBot,
    update: CourierBotUpdate,
  ): Promise<boolean> {
    const cq = update?.callback_query;
    if (cq) {
      if (!cq.data?.startsWith('cr:')) return false;
      await this.onButton(bot, cq);
      return true;
    }

    const msg = update?.message;
    if (
      !msg?.chat ||
      msg.chat.type !== 'private' ||
      !msg.from ||
      msg.from.is_bot
    )
      return false;
    const text = (msg.text ?? '').trim();
    const chatId = String(msg.chat.id);

    const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text);
    const inviteToken = start ? inviteTokenFromStart(start[1]) : null;
    if (start?.[1] && inviteToken === null && start[1].startsWith('c_')) {
      await this.reply(
        bot,
        chatId,
        COURIER_TEXTS[courierLang(msg.from.language_code)].inviteInvalid,
      );
      return true;
    }
    if (inviteToken) {
      await this.onInvite(bot, chatId, msg.from, inviteToken);
      return true;
    }

    const command = menuCommand(text);
    if (!command && !(start && !start[1])) return false;
    const c = await this.courierOf(bot, msg.from.id);
    if (!c) return false; // a guest pressing /start: the guest flow answers
    const t = COURIER_TEXTS[await this.touchLang(c, msg.from.language_code)];
    if (!c.is_active) {
      await this.reply(bot, chatId, t.disabled, { remove_keyboard: true });
      return true;
    }
    if (!command) {
      // /start of a linked courier: the menu, with the shift state
      const open = await this.prisma.courier_shift.count({
        where: { courier_id: c.id, status: 'open' },
      });
      await this.reply(
        bot,
        chatId,
        open ? t.shiftAlreadyOpen : t.shiftNotOpen,
        courierMenu(t),
      );
      return true;
    }
    if (command === 'start') return this.onStartShift(bot, chatId, c, t);
    if (command === 'end') return this.onEndShift(bot, chatId, c, t);
    return this.onMyOrders(bot, chatId, c, t);
  }

  // ------------------------------------------------------------ invitation

  private async onInvite(
    bot: TenantBot,
    chatId: string,
    from: { id: number; language_code?: string },
    token: string,
  ) {
    const lang = courierLang(from.language_code);
    const t = COURIER_TEXTS[lang];
    const invitation = await this.prisma.courier_invitation.findUnique({
      where: { token_hash: hashInviteToken(token) },
      include: {
        courier: { include: { organization: { select: { name: true } } } },
      },
    });
    const now = new Date();
    const c = invitation?.courier;
    if (
      !invitation ||
      !c ||
      c.organization_id !== bot.organizationId ||
      !c.is_active ||
      !inviteUsable(invitation, now)
    )
      return this.reply(bot, chatId, t.inviteInvalid);

    const telegramUserId = String(from.id);
    const other = await this.prisma.courier.findFirst({
      where: {
        organization_id: bot.organizationId,
        telegram_user_id: telegramUserId,
        NOT: { id: c.id },
      },
    });
    if (other) return this.reply(bot, chatId, t.inviteOtherCourier);

    // One-time: only the first press of a usable link links the courier
    const linked = await this.prisma.$transaction(async (tx) => {
      const used = await tx.courier_invitation.updateMany({
        where: {
          id: invitation.id,
          used_at: null,
          revoked_at: null,
          expires_at: { gt: now },
        },
        data: { used_at: now },
      });
      if (!used.count) return false;
      await tx.courier.update({
        where: { id: c.id },
        data: {
          telegram_user_id: telegramUserId,
          telegram_chat_id: chatId,
          language_code: from.language_code ?? null,
          linked_at: now,
        },
      });
      return true;
    });
    if (!linked) return this.reply(bot, chatId, t.inviteInvalid);
    await this.reply(
      bot,
      chatId,
      t.linked(c.organization.name),
      courierMenu(t),
    );
  }

  // ------------------------------------------------------------ menu

  private async onStartShift(
    bot: TenantBot,
    chatId: string,
    c: courier,
    t: CourierTexts,
  ) {
    const result = await this.shifts.start(c.organization_id, c.id);
    await this.reply(
      bot,
      chatId,
      result.kind === 'started' ? t.shiftStarted : t.shiftAlreadyOpen,
      courierMenu(t),
    );
    return true;
  }

  private async onEndShift(
    bot: TenantBot,
    chatId: string,
    c: courier,
    t: CourierTexts,
  ) {
    const result = await this.shifts.end(c.id, { by: 'courier' });
    const text =
      result.kind === 'ended'
        ? t.shiftEnded
        : result.kind === 'not_open'
          ? t.shiftNotOpen
          : t.shiftHasOrders(result.activeOrders);
    await this.reply(bot, chatId, text, courierMenu(t));
    return true;
  }

  /** Send the cards of the courier's unfinished orders again, as new messages at the bottom of the chat. */
  private async onMyOrders(
    bot: TenantBot,
    chatId: string,
    c: courier,
    t: CourierTexts,
  ) {
    const orders = await this.prisma.customer_order.findMany({
      where: { courier_id: c.id, status: { in: [...COURIER_HELD_STATUSES] } },
      select: { id: true },
      orderBy: { created_at: 'asc' },
    });
    if (!orders.length) {
      await this.reply(bot, chatId, t.noOrders, courierMenu(t));
      return true;
    }
    for (const o of orders)
      await this.cards.refresh(o.id, c.id, { resend: true });
    return true;
  }

  // ------------------------------------------------------------ buttons

  private async onButton(
    bot: TenantBot,
    cq: NonNullable<CourierBotUpdate['callback_query']>,
  ) {
    const action = parseCourierAction(cq.data);
    const c = await this.courierOf(bot, cq.from.id);
    const lang: CourierLang = c
      ? await this.touchLang(c, cq.from.language_code)
      : courierLang(cq.from.language_code);
    const t = COURIER_TEXTS[lang];
    if (!c) return this.answer(bot, cq.id, t.notCourier);
    if (!c.is_active) return this.answer(bot, cq.id, t.disabled);
    if (!action) return this.answer(bot, cq.id, t.notAvailable);

    let answer: Answer | { text: string };
    try {
      answer = await this.act(c, action);
    } catch (e) {
      this.logger.error(
        `Courier button ${action.a} failed: ${telegramErrorText(e)}`,
      );
      answer = 'notAvailable';
    }
    return this.answer(
      bot,
      cq.id,
      typeof answer === 'string' ? t[answer] : answer.text,
    );
  }

  private async act(
    c: courier,
    action: CourierAction,
  ): Promise<Answer | { text: string }> {
    if (action.a === 'pick_all') {
      const ready = await this.prisma.customer_order.findMany({
        where: {
          courier_id: c.id,
          status: 'ready',
          branch_id: action.branchId,
          organization_id: c.organization_id,
        },
        select: { id: true },
      });
      if (!ready.length) return 'alreadyDone';
      let moved = 0;
      for (const o of ready)
        if ((await this.move(c, o.id, { to: 'on_the_way' })) === 'done')
          moved++;
      return moved ? 'done' : 'alreadyDone';
    }

    const order = await this.prisma.customer_order.findFirst({
      where: { id: action.orderId, organization_id: c.organization_id },
      select: { id: true, courier_id: true, status: true },
    });
    if (!order) return 'notYours';

    switch (action.a) {
      case 'pick':
        return this.move(c, order.id, { to: 'on_the_way' });
      case 'delivered':
        return this.move(c, order.id, { to: 'completed', note: 'delivered' });
      case 'no_answer':
        return this.move(c, order.id, {
          to: 'problem_at_door',
          doorProblem: { kind: 'no_answer' },
        });
      case 'refused':
        return this.move(c, order.id, {
          to: 'problem_at_door',
          doorProblem: { kind: 'refused', reason: action.reason },
          note: `refused:${action.reason}`,
        });
      case 'cannot_deliver':
        return this.move(c, order.id, { to: 'ready', note: 'cannot_deliver' });
      case 'refuse_menu':
      case 'back': {
        if (order.courier_id !== c.id) return 'notYours';
        if (order.status !== 'on_the_way') return 'notAvailable';
        await this.cards.refresh(order.id, c.id, {
          refuseMenu: action.a === 'refuse_menu',
        });
        return { text: '' };
      }
    }
  }

  /**
   * One courier step through OrderTransitionService. A refusal is told apart: the same step pressed again
   * ("already marked"), an order that is not the courier's, or a step not possible now.
   */
  private async move(
    c: courier,
    orderId: string,
    step: Pick<TransitionInput, 'to' | 'doorProblem' | 'note'>,
  ): Promise<Answer> {
    try {
      await this.transitions.transition({
        orderId,
        actor: 'courier',
        actorId: c.id,
        ...step,
      });
      return 'done';
    } catch (e) {
      if (e instanceof OrderNotFoundError) return 'notYours';
      if (
        !(e instanceof InvalidTransitionError) &&
        !(e instanceof CourierNotAssignedError)
      )
        throw e;
      return this.repeatedOrRefused(c, orderId, step);
    }
  }

  private async repeatedOrRefused(
    c: courier,
    orderId: string,
    step: Pick<TransitionInput, 'to' | 'doorProblem'>,
  ): Promise<Answer> {
    const to: OrderStatusName = step.to;
    const order = await this.prisma.customer_order.findUnique({
      where: { id: orderId },
      select: { status: true, courier_id: true, door_problem: true },
    });
    if (!order) return 'notYours';
    // The same press again: the order is already where this courier's press moved it
    const last = await this.prisma.order_status_event.findFirst({
      where: { order_id: orderId, actor: 'courier', actor_id: c.id },
      orderBy: { id: 'desc' },
      select: { to_status: true },
    });
    const sameProblem =
      to !== 'problem_at_door' || order.door_problem === step.doorProblem?.kind;
    if (last && last.to_status === to && order.status === to && sameProblem)
      return 'alreadyDone';
    if (order.courier_id !== c.id) return 'notYours';
    return 'notAvailable';
  }

  // ------------------------------------------------------------ helpers

  private courierOf(bot: TenantBot, telegramUserId: number) {
    return this.prisma.courier.findFirst({
      where: {
        organization_id: bot.organizationId,
        telegram_user_id: String(telegramUserId),
      },
    });
  }

  /** Telegram tells the courier's current language on every update: keep it for the cards sent later. */
  private async touchLang(
    c: courier,
    code: string | undefined,
  ): Promise<CourierLang> {
    if (code && code !== c.language_code) {
      await this.prisma.courier.update({
        where: { id: c.id },
        data: { language_code: code },
      });
      c.language_code = code;
    }
    return courierLang(c.language_code);
  }

  private async reply(
    bot: TenantBot,
    chatId: string,
    text: string,
    replyMarkup?: Record<string, unknown>,
  ) {
    try {
      await this.cards.say(bot, chatId, text, replyMarkup);
    } catch (e) {
      this.logger.warn(`Reply to a courier failed: ${telegramErrorText(e)}`);
    }
  }

  private async answer(bot: TenantBot, callbackQueryId: string, text: string) {
    try {
      await this.telegram.call(bot.token, 'answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        ...(text ? { text } : {}),
      });
    } catch (e) {
      this.logger.warn(`answerCallbackQuery failed: ${telegramErrorText(e)}`);
    }
  }
}
