import { Injectable } from '@nestjs/common';
import { sendOtpWithButton } from 'src/infra/helper/tg-bot/otp-bot';
import { SmsProvider } from './sms-provider.interface';

/** Mavjud OTP Telegram-bot orqali yuboradi (sizning joriy dev oqimingiz). */
@Injectable()
export class TelegramSmsProvider implements SmsProvider {
  async send(phone: string, text: string): Promise<void> {
    // otp-bot helperi (code, phone) qabul qiladi; matnni to'liq yuborish uchun code o'rniga text beramiz
    await sendOtpWithButton(text, phone);
  }
}
