import { Injectable } from '@nestjs/common';
import { sendCustomerOtpSms } from 'src/infra/helper/tg-bot/otp-bot';
import { SmsProvider } from './sms-provider.interface';

/**
 * Mijoz OTP kodlarini real SMS o'rniga jamoaning Telegram guruhiga
 * yuboradi — Eskiz hisobisiz ham “nomer orqali kirish” oqimini oxirigacha
 * sinab ko'rish uchun (SMS_PROVIDER=telegram orqali yoqiladi). Loyiha
 * ishga tushganda SMS_PROVIDER=eskiz'ga o'tkaziladi — kod shu yerda
 * o'zgarmaydi, faqat .env'dagi bitta qiymat.
 */
@Injectable()
export class TelegramSmsProvider implements SmsProvider {
  async send(phone: string, text: string): Promise<void> {
    await sendCustomerOtpSms(phone, text);
  }
}
