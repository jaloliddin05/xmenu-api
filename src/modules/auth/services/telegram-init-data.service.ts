import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { CUSTOMER_AUTH_CONFIG } from '../customer-auth.config';
import type { CustomerAuthConfig } from '../customer-auth.config';
import { CustomerAuthException } from '../errors/customer-auth.exception';

export interface TelegramUser {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

@Injectable()
export class TelegramInitDataService {
  constructor(@Inject(CUSTOMER_AUTH_CONFIG) private readonly cfg: CustomerAuthConfig) {}

  /** Telegram WebApp initData imzosini tekshiradi va user'ni qaytaradi. */
  verify(initData: string): TelegramUser {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not configured');

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
