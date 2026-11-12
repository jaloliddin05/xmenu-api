import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { TelegramApiService } from '../services/telegram-api.service';
import { OrderStatusName } from '../domain/order-state-machine';
import { customerLangFor } from './customer-language';
import { buildCustomerText } from './order-messages';

/**
 * Mijozga holat o'zgarishi haqida Telegram xabari (ilova yopiq bo'lsa ham).
 * Bot foydalanuvchiga faqat u botni ishga tushirgan bo'lsa yoza oladi — Mini App
 * bot orqali ochiladi, odatda shunday. Yubora olmasa jim o'tkazib yuboriladi.
 * Til: mijozning tanlangan tili (customer.language), u yo'q yoki o'chirilgan bo'lsa — restoran tili.
 */
@Injectable()
export class CustomerNotifierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramApiService,
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
        customer: { select: { telegram_id: true, language: true } },
      },
    });
    const chatId = order?.customer.telegram_id;
    if (!order || !chatId) return;

    const lang = await customerLangFor(
      this.prisma,
      order.organization_id,
      order.customer.language,
    );
    const text = buildCustomerText(order, from, lang);
    if (text) await this.telegram.sendMessage(chatId, text);
  }
}
