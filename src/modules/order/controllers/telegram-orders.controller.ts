import { SkipPublicRateLimit } from 'src/infra/http/public-rate-limit';
import { Body, Controller, Headers, HttpCode, Logger, Post, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { Public } from 'src/modules/auth/decorators/public.decorator';
import { RestaurantNotifierService } from '../notifications/restaurant-notifier.service';
import { CALLBACK } from '../notifications/order-messages';
import { TelegramApiService } from '../services/telegram-api.service';
import { OrderStaffService, RestaurantAction } from '../services/order-staff.service';

interface CallbackQuery {
  id: string;
  data?: string;
  from: { id: number };
  message?: { chat: { id: number } };
}

/**
 * Restoran guruhidagi inline tugmalar (Принять / Отклонить / Далее) shu webhook
 * orqali keladi. Sozlash (bir marta):
 *   POST https://api.telegram.org/bot<TOKEN>/setWebhook
 *     { url: "<API>/telegram/orders/webhook", secret_token: "<TELEGRAM_WEBHOOK_SECRET>",
 *       allowed_updates: ["callback_query"] }
 *
 * Xavfsizlik:
 *  1. secret_token sarlavhasi (timingSafeEqual) — Telegram'dan boshqa hech kim chaqira olmaydi.
 *  2. Tugma bosilgan CHAT buyurtma filialining telegram_chat_id si bo'lishi shart —
 *     boshqa guruh (yoki boshqa tenant) tugmani soxtalashtirib buyurtmani boshqara olmaydi.
 * Telegram qayta yuborishini oldini olish uchun javob doim 200.
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
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Headers('x-telegram-bot-api-secret-token') secret: string | undefined, @Body() update: { callback_query?: CallbackQuery }) {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expected) throw new ServiceUnavailableException('Webhook is not configured');
    if (!secret || secret.length !== expected.length || !timingSafeEqual(Buffer.from(secret), Buffer.from(expected))) {
      throw new UnauthorizedException();
    }

    const cq = update?.callback_query;
    if (cq) {
      try {
        await this.handleCallback(cq);
      } catch (e: any) {
        this.logger.error(`callback failed: ${e?.stack ?? e}`);
        await this.telegram.answerCallbackQuery(cq.id, 'Ошибка, попробуйте ещё раз');
      }
    }
    return { ok: true };
  }

  private async handleCallback(cq: CallbackQuery) {
    const parsed = parseCallback(cq.data);
    if (!parsed) return void (await this.telegram.answerCallbackQuery(cq.id));

    const order = await this.prisma.customer_order.findUnique({
      where: { id: parsed.orderId },
      select: { id: true, number: true, branch: { select: { telegram_chat_id: true } } },
    });
    const chatId = cq.message?.chat.id != null ? String(cq.message.chat.id) : null;
    if (!order || !chatId || order.branch.telegram_chat_id !== chatId) {
      this.logger.warn(`Callback from chat ${chatId} rejected for order ${parsed.orderId}`);
      return void (await this.telegram.answerCallbackQuery(cq.id, 'Нет доступа'));
    }

    const result = await this.staff.perform(null, order.id, parsed.action, `tg:${cq.from.id}`);
    if (result.changed) {
      await this.telegram.answerCallbackQuery(cq.id, toast(parsed.action));
    } else {
      // Boshqa xodim allaqachon bosgan — eskirgan tugmalarni yangilab qo'yamiz.
      await this.telegram.answerCallbackQuery(cq.id, 'Уже обработано');
      await this.restaurant.refreshMessage(order.id);
    }
  }
}

export function parseCallback(data: string | undefined): { action: RestaurantAction; orderId: string } | null {
  if (!data) return null;
  const uuid = '[0-9a-fA-F-]{36}';
  const m = new RegExp(`^(${escapeRe(CALLBACK.accept)}|${escapeRe(CALLBACK.reject)}|${escapeRe(CALLBACK.next)})(${uuid})$`).exec(data);
  if (!m) return null;
  const action: RestaurantAction =
    m[1] === CALLBACK.accept ? { type: 'accept' } : m[1] === CALLBACK.reject ? { type: 'reject', reason: 'declined' } : { type: 'next' };
  return { action, orderId: m[2] };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toast = (a: RestaurantAction) => (a.type === 'accept' ? 'Заказ принят' : a.type === 'reject' ? 'Заказ отклонён' : 'Статус обновлён');
