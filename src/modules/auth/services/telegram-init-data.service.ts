import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { CUSTOMER_AUTH_CONFIG } from '../customer-auth.config';
import type { CustomerAuthConfig } from '../customer-auth.config';
import { CustomerAuthException } from '../errors/customer-auth.exception';
import { TelegramBotService } from '../../telegram/telegram-bot.service';

export interface TelegramUser {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

@Injectable()
export class TelegramInitDataService {
  constructor(
    @Inject(CUSTOMER_AUTH_CONFIG) private readonly cfg: CustomerAuthConfig,
    private readonly bots: TelegramBotService,
  ) {}

  /**
   * initData is signed with the token of the bot that opened the Mini App: the venue's own bot,
   * or the platform bot (TELEGRAM_BOT_TOKEN) while the venue has not connected one.
   */
  async verifyForTenant(tenantId: string, initData: string): Promise<TelegramUser> {
    const token = await this.bots.initDataToken(tenantId);
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    return this.verifyWithToken(initData, token);
  }

  /** Verifies the WebApp initData signature against `botToken` and returns the user. */
  verifyWithToken(initData: string, botToken: string): TelegramUser {
    const bad = () => new CustomerAuthException('invalid_telegram_data', 'Invalid Telegram initData');

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) throw bad();
    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculated = createHmac('sha256', secretKey).update(dataCheckString).digest();

    let given: Buffer;
    try {
      given = Buffer.from(hash, 'hex');
    } catch {
      throw bad();
    }
    if (given.length !== calculated.length || !timingSafeEqual(given, calculated)) throw bad();

    // Eski initData qayta ishlatilishiga yo'l qo'ymaymiz
    const authDate = Number(params.get('auth_date'));
    if (!authDate || Date.now() / 1000 - authDate > this.cfg.telegramInitDataMaxAgeSeconds) throw bad();

    const userString = params.get('user');
    if (!userString) throw bad();
    try {
      const user = JSON.parse(userString);
      if (!user?.id) throw bad();
      return user;
    } catch {
      throw bad();
    }
  }
}
