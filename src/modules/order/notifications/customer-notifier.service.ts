import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { TelegramApiService } from '../services/telegram-api.service';
import { OrderStatusName } from '../domain/order-state-machine';
import { buildCustomerText } from './order-messages';

/**
 * Mijozga holat o'zgarishi haqida Telegram xabari (ilova yopiq bo'lsa ham).
 * Bot foydalanuvchiga faqat u botni ishga tushirgan bo'lsa yoza oladi — Mini App
 * bot orqali ochiladi, odatda shunday. Yubora olmasa jim o'tkazib yuboriladi.
 * Til: hozircha rus (mijozda til maydoni yo'q).
 */
@Injectable()
export class CustomerNotifierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramApiService,
  ) {}

  async notifyStatus(orderId: string, from: OrderStatusName | null): Promise<void> {
    const order = await this.prisma.customer_order.findUnique({
      where: { id: orderId },
      select: {
        number: true, status: true, payment_method: true, payment_status: true, cancelled_by: true,
        customer: { select: { telegram_id: true } },
      },
    });
    const chatId = order?.customer.telegram_id;
    if (!order || !chatId) return;

    const text = buildCustomerText(order, from);
    if (text) await this.telegram.sendMessage(chatId, text);
  }
}
