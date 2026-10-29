import { Injectable, Logger } from '@nestjs/common';
import { TelegramApiService } from '../services/telegram-api.service';

/**
 * Platforma jamoasiga (restoranga emas) signal: qo'lda aralashuv kerak bo'lgan
 * holatlar — avtomatik qaytarib bo'lmagan to'lov, filialda SMS uchun telefon yo'qligi.
 * Chat: OPS_CHAT_ID, bo'lmasa XMENU_CHAT_ID (otp-bot.ts dagi jamoa guruhi).
 */
@Injectable()
export class OpsNotifierService {
  private readonly logger = new Logger('Ops');

  constructor(private readonly telegram: TelegramApiService) {}

  async alert(text: string): Promise<void> {
    this.logger.warn(text);
    const chat = process.env.OPS_CHAT_ID || process.env.XMENU_CHAT_ID;
    if (chat) await this.telegram.sendMessage(chat, `🚨 ${text}`);
  }
}
