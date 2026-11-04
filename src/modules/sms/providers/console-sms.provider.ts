import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface';

/** Faqat development uchun: xabarni konsolga chiqaradi. */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('ConsoleSms');

  send(phone: string, text: string): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      return Promise.reject(
        new Error("ConsoleSmsProvider production'da ishlatilmaydi"),
      );
    }
    this.logger.log(`[DEV SMS] ${phone}: ${text}`);
    return Promise.resolve();
  }
}
