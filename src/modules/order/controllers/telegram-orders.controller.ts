import { errorMessage, errorStack } from 'src/infra/helper/error-text';
import { SkipPublicRateLimit } from 'src/infra/http/public-rate-limit';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import Redis from 'ioredis';
import { REDIS } from 'src/infra/redis/redis.module';
import { claimTelegramUpdate } from 'src/infra/telegram/update-dedupe';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { Public } from 'src/modules/auth/decorators/public.decorator';
import { RestaurantNotifierService } from '../notifications/restaurant-notifier.service';
import { BIND_TEXT, CALLBACK } from '../notifications/order-messages';
import {
  BranchChatBindingService,
  parseBindCommand,
} from '../services/branch-chat-binding.service';
import { TelegramApiService } from '../services/telegram-api.service';
import {
  OrderStaffService,
  RestaurantAction,
} from '../services/order-staff.service';
import { ORDER_STATUSES, OrderStatusName } from '../domain/order-state-machine';
import {
  AppException,
  platformMisconfigured,
} from 'src/infra/errors/app-exception';

interface CallbackQuery {
  id: string;
  data?: string;
  from: { id: number };
  message?: { chat: { id: number } };
}

interface ChatMessage {
  chat?: { id?: number; type?: string };
  text?: string;
  /** Service message in the old group: it became a supergroup with this id */
  migrate_to_chat_id?: number;
  /** Service message in the new supergroup: it was the group with this id */
  migrate_from_chat_id?: number;
}

/** Remembered update ids of the platform bot: Telegram retries a delivery for up to a day */
const UPDATE_TTL_SECONDS = 24 * 3600;
const updateKey = (updateId: number) => `tgo:upd:${updateId}`;

/**
 * Restoran guruhidagi inline tugmalar (Принять / Отклонить / Далее) shu webhook
 * orqali keladi; `/bind CODE` in a group binds that chat to a branch (BranchChatBindingService).
 * Sozlash (bir marta):
 *   POST https://api.telegram.org/bot<TOKEN>/setWebhook
 *     { url: "<API>/telegram/orders/webhook", secret_token: "<TELEGRAM_WEBHOOK_SECRET>",
 *       allowed_updates: ["callback_query", "message"] }
 *
 * Xavfsizlik:
 *  1. secret_token sarlavhasi (timingSafeEqual) — Telegram'dan boshqa hech kim chaqira olmaydi.
 *  2. Tugma bosilgan CHAT buyurtma filialining telegram_chat_id si bo'lishi shart —
 *     boshqa guruh (yoki boshqa tenant) tugmani soxtalashtirib buyurtmani boshqara olmaydi.
 *  3. Every update is handled once (update_id in Redis for a day), and every order button carries the status it
 *     was drawn for: a repeated delivery or a second press never moves the order one more step.
 * Telegram qayta yuborishini oldini olish uchun javob doim 200 (after the secret check).
 * A group that becomes a supergroup sends migrate_to_chat_id / migrate_from_chat_id: the binding moves along.
 */
@ApiExcludeController()
@Public()
@SkipPublicRateLimit()
@Controller('telegram/orders')
export class TelegramOrdersController {
  private readonly logger = new Logger('TelegramOrders');

  constructor(
    private readonly prisma: PrismaService,
    private readonly staff: OrderStaffService,
    private readonly telegram: TelegramApiService,
    private readonly restaurant: RestaurantNotifierService,
    private readonly binding: BranchChatBindingService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body()
    update: {
      update_id?: number;
      callback_query?: CallbackQuery;
      message?: ChatMessage;
    },
  ) {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expected)
      throw platformMisconfigured(
        'order_notifications',
        'TELEGRAM_WEBHOOK_SECRET is not set',
      );
    if (
      !secret ||
      secret.length !== expected.length ||
      !timingSafeEqual(Buffer.from(secret), Buffer.from(expected))
    ) {
      throw new AppException('unauthorized');
    }

    if (!(await this.claim(update?.update_id))) return { ok: true };

    const cq = update?.callback_query;
    if (cq) {
      try {
        await this.handleCallback(cq);
      } catch (e) {
        this.logger.error(`callback failed: ${errorStack(e)}`);
        await this.telegram
          .answerCallbackQuery(cq.id, 'Ошибка, попробуйте ещё раз')
          .catch(() => undefined);
      }
    }
    const message = update?.message;
    if (message) {
      try {
        await this.handleMessage(message);
      } catch (e) {
        this.logger.error(`message failed: ${errorStack(e)}`);
      }
    }
    return { ok: true };
  }

  /** First delivery of the update? Without Redis the update is handled anyway (a repeat is rare, a loss is worse). */
  private async claim(updateId: number | undefined): Promise<boolean> {
    try {
      return await claimTelegramUpdate(
        this.redis,
        updateKey,
        updateId,
        UPDATE_TTL_SECONDS,
      );
    } catch (e) {
      this.logger.warn(
        `update ${String(updateId)} not deduplicated: ${errorMessage(e)}`,
      );
      return true;
    }
  }

  /**
   * A group that became a supergroup (a service message in each chat) moves the binding; otherwise only
   * `/bind CODE` is answered, any other message in a branch chat is ignored.
   */
  private async handleMessage(message: ChatMessage) {
    const chat = message.chat?.id;
    if (chat != null && typeof message.migrate_to_chat_id === 'number')
      return this.restaurant.migrateChat(
        String(chat),
        String(message.migrate_to_chat_id),
      );
    if (chat != null && typeof message.migrate_from_chat_id === 'number')
      return this.restaurant.migrateChat(
        String(message.migrate_from_chat_id),
        String(chat),
      );

    const code = parseBindCommand(message.text);
    const chatId = message.chat?.id;
    if (code === undefined || chatId == null) return;
    const type = message.chat?.type;
    if (type !== 'group' && type !== 'supergroup')
      return void (await this.telegram.sendMessage(
        chatId,
        BIND_TEXT.groupOnly,
      ));
    if (!code)
      return void (await this.telegram.sendMessage(chatId, BIND_TEXT.usage));
    const result = await this.binding.bind(String(chatId), code);
    const text =
      result.status === 'bound'
        ? BIND_TEXT.bound(result.branchTitle)
        : result.status === 'rate_limited'
          ? BIND_TEXT.tooMany
          : BIND_TEXT.invalid;
    await this.telegram.sendMessage(chatId, text);
  }

  private async handleCallback(cq: CallbackQuery) {
    const parsed = parseCallback(cq.data);
    if (!parsed) return void (await this.telegram.answerCallbackQuery(cq.id));

    const order = await this.prisma.customer_order.findUnique({
      where: { id: parsed.orderId },
      select: {
        id: true,
        number: true,
        branch: { select: { telegram_chat_id: true } },
      },
    });
    const chatId =
      cq.message?.chat.id != null ? String(cq.message.chat.id) : null;
    if (!order || !chatId || order.branch.telegram_chat_id !== chatId) {
      this.logger.warn(
        `Callback from chat ${chatId} rejected for order ${parsed.orderId}`,
      );
      return void (await this.telegram.answerCallbackQuery(
        cq.id,
        'Нет доступа',
      ));
    }

    // A button drawn before buttons carried the status: the order stays, the card gets current buttons
    if (!parsed.expected) {
      await this.telegram.answerCallbackQuery(
        cq.id,
        'Кнопка устарела, обновлено',
      );
      return void (await this.restaurant.refreshMessage(order.id));
    }

    const result = await this.staff.perform(
      null,
      order.id,
      parsed.action,
      `tg:${cq.from.id}`,
      parsed.expected,
    );
    if (result.changed) {
      await this.telegram.answerCallbackQuery(cq.id, toast(parsed.action));
    } else {
      // Boshqa xodim allaqachon bosgan — eskirgan tugmalarni yangilab qo'yamiz.
      await this.telegram.answerCallbackQuery(cq.id, 'Уже обработано');
      await this.restaurant.refreshMessage(order.id);
    }
  }
}

/**
 * `o:<a|r|n>:<status>:<orderId>`; the old form without the status (`o:<a|r|n>:<orderId>`, buttons drawn before)
 * parses with `expected` undefined. An unknown status is no button of ours.
 */
export function parseCallback(data: string | undefined): {
  action: RestaurantAction;
  orderId: string;
  expected?: OrderStatusName;
} | null {
  if (!data) return null;
  const uuid = '[0-9a-fA-F-]{36}';
  const m = new RegExp(
    `^(${escapeRe(CALLBACK.accept)}|${escapeRe(CALLBACK.reject)}|${escapeRe(CALLBACK.next)})(?:([a-z_]+):)?(${uuid})$`,
  ).exec(data);
  if (!m) return null;
  const expected = m[2] as OrderStatusName | undefined;
  if (expected !== undefined && !ORDER_STATUSES.includes(expected)) return null;
  const action: RestaurantAction =
    m[1] === CALLBACK.accept
      ? { type: 'accept' }
      : m[1] === CALLBACK.reject
        ? { type: 'reject', reason: 'declined' }
        : { type: 'next' };
  return expected
    ? { action, orderId: m[3], expected }
    : { action, orderId: m[3] };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toast = (a: RestaurantAction) =>
  a.type === 'accept'
    ? 'Заказ принят'
    : a.type === 'reject'
      ? 'Заказ отклонён'
      : 'Статус обновлён';
