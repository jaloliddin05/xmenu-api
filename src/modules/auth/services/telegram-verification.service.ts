import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { randomBytes } from 'crypto';
import { REDIS } from 'src/infra/redis/redis.module';
import { isValidPhone } from 'src/infra/helper/auth/customer-validators';
import type { Tenant } from 'src/modules/tenant/tenant.service';
import { TelegramBotService } from 'src/modules/telegram/telegram-bot.service';
import type { TenantBot } from 'src/modules/telegram/telegram-bot.service';
import {
  TelegramClient,
  telegramErrorText,
} from 'src/modules/telegram/telegram-client';
import { CUSTOMER_AUTH_CONFIG } from '../customer-auth.config';
import type { CustomerAuthConfig } from '../customer-auth.config';
import { CustomerAuthException } from '../errors/customer-auth.exception';
import { CustomerAuthService } from './customer-auth.service';
import type { VerifyResult } from './customer-auth.service';
import { CustomerAuthEventService } from './customer-auth-event.service';
import type { RequestCtx } from './customer-auth-event.service';
import { CustomerOtpService } from './customer-otp.service';
import { RateLimitService } from './rate-limit.service';
import type { RateRule } from './rate-limit.service';
import { TelegramInitDataService } from './telegram-init-data.service';
import { BOT_MESSAGES } from './telegram-verification.messages';
import {
  normalizeTelegramPhone,
  pickBotLang,
} from './telegram-verification.util';

export type TelegramVerifyMode = 'instant' | 'code';

export interface TelegramStartResult {
  sessionId: string;
  mode: TelegramVerifyMode;
  botUsername: string;
  deepLink: string;
  expiresIn: number;
}

export type TelegramStatusResult =
  | { status: 'pending' }
  | { status: 'code_sent'; phone: string }
  | { status: 'expired' }
  | ({ status: 'verified' } & VerifyResult);

export interface TelegramMessage {
  chat?: { id: number; type?: string };
  from?: { id: number; is_bot?: boolean; language_code?: string };
  text?: string;
  contact?: { phone_number?: string; user_id?: number };
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

interface Session {
  tenantId: string;
  botKey: string;
  brand: string;
  mode: TelegramVerifyMode;
  status: 'pending' | 'code_sent' | 'verified';
  phoneExpected?: string;
  tgUserId?: string;
  phone?: string;
  attempts: number;
}

const SID_RE = /^[A-Za-z0-9_-]{20,64}$/;
const MAX_CONTACT_ATTEMPTS = 3;
const REMOVE_KEYBOARD = { remove_keyboard: true };

const sKey = (sid: string) => `tgv:s:${sid}`;
const uKey = (botKey: string, tgUserId: string) =>
  `tgv:u:${botKey}:${tgUserId}`;

/**
 * Phone verification through the venue's own Telegram bot.
 *
 * Mini App ("instant"): the session is bound to the Telegram user taken from signed initData.
 * When that same user shares their contact with the bot, the phone is confirmed, no code to type.
 * Because of the binding, forwarding the link to someone else cannot hijack the session.
 *
 * Website ("code"): the client supplies the phone; the user opens the bot via a deep link and
 * shares their contact; only if the contact's phone equals the requested one a one-time code
 * is sent into that chat, and the client finishes with the normal otp/verify call.
 *
 * Both rely on the bot only accepting a contact that belongs to the sender
 * (contact.user_id === from.id): a forwarded foreign contact proves nothing.
 */
@Injectable()
export class TelegramVerificationService {
  private readonly logger = new Logger('TelegramVerify');

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CUSTOMER_AUTH_CONFIG) private readonly cfg: CustomerAuthConfig,
    private readonly bots: TelegramBotService,
    private readonly initData: TelegramInitDataService,
    private readonly otp: CustomerOtpService,
    private readonly rateLimit: RateLimitService,
    private readonly client: TelegramClient,
    private readonly events: CustomerAuthEventService,
    private readonly auth: CustomerAuthService,
  ) {}

  // ================= POST auth/customer/telegram/start =================

  async start(
    tenant: Tenant,
    dto: { phone?: string; initData?: string },
    ctx: RequestCtx,
  ): Promise<TelegramStartResult> {
    const bot = await this.bots.forTenant(tenant.id);
    if (!bot) {
      throw new CustomerAuthException(
        'telegram_unavailable',
        'Telegram bot is not connected for this tenant',
      );
    }
    if (dto.phone !== undefined && !isValidPhone(dto.phone)) {
      throw new CustomerAuthException('invalid_phone');
    }

    // Only the venue's own bot can have opened the Mini App that starts this flow
    const tgUserId = dto.initData
      ? String(this.initData.verifyWithToken(dto.initData, bot.token).id)
      : undefined;
    const mode: TelegramVerifyMode = tgUserId ? 'instant' : 'code';
    // Without initData nothing identifies the Telegram user: the contact is checked against the phone
    if (mode === 'code' && !dto.phone)
      throw new CustomerAuthException('invalid_phone');

    const rules: RateRule[] = [
      { key: `tgv:rl:ip:${ctx.ip}`, limit: 20, ttlSeconds: 3600 },
    ];
    if (dto.phone)
      rules.push({
        key: `tgv:rl:phone:${dto.phone}`,
        limit: 5,
        ttlSeconds: 3600,
      });
    if (tgUserId)
      rules.push({
        key: `tgv:rl:tg:${bot.botKey}:${tgUserId}`,
        limit: 10,
        ttlSeconds: 3600,
      });
    await this.rateLimit.hit(rules);

    const sessionId = randomBytes(24).toString('base64url');
    const ttl = this.cfg.telegramVerifyTtlSeconds;
    const fields: Record<string, string> = {
      tenantId: tenant.id,
      botKey: bot.botKey,
      brand: tenant.brandName,
      mode,
      status: 'pending',
      attempts: '0',
    };
    if (dto.phone) fields.phoneExpected = dto.phone;
    if (tgUserId) fields.tgUserId = tgUserId;

    await this.redis
      .multi()
      .hset(sKey(sessionId), fields)
      .expire(sKey(sessionId), ttl)
      .exec();
    if (tgUserId)
      await this.redis.set(uKey(bot.botKey, tgUserId), sessionId, 'EX', ttl);

    await this.events.log('telegram_verify_started', ctx, {
      tenantId: tenant.id,
      phone: dto.phone,
      meta: { mode },
    });
    return {
      sessionId,
      mode,
      botUsername: bot.username,
      deepLink: `https://t.me/${bot.username}?start=${sessionId}`,
      expiresIn: ttl,
    };
  }

  // ================= POST auth/customer/telegram/status =================

  async status(
    tenant: Tenant,
    sessionId: string,
    ctx: RequestCtx,
  ): Promise<TelegramStatusResult> {
    await this.rateLimit.hit([
      { key: `tgv:poll:${sessionId}`, limit: 200, ttlSeconds: 300 },
      { key: `tgv:poll:ip:${ctx.ip}`, limit: 600, ttlSeconds: 900 },
    ]);

    const session = await this.load(sessionId);
    if (!session || session.tenantId !== tenant.id)
      return { status: 'expired' };
    if (session.status === 'pending') return { status: 'pending' };
    if (session.status === 'code_sent')
      return { status: 'code_sent', phone: session.phone! };

    // verified (instant mode): hand out the login result exactly once
    const usedKey = `tgv:used:${sessionId}`;
    const first = await this.redis.set(usedKey, '1', 'EX', 600, 'NX');
    if (first !== 'OK') return { status: 'pending' }; // a parallel poll is completing it
    try {
      const result = await this.auth.completeVerifiedPhone(
        tenant,
        session.phone!,
        ctx,
        {
          telegramId: session.tgUserId,
        },
      );
      await this.redis.del(sKey(sessionId));
      return { status: 'verified', ...result };
    } catch (err) {
      await this.redis.del(usedKey);
      throw err;
    }
  }

  // ================= Bot webhook =================

  async handleUpdate(bot: TenantBot, update: TelegramUpdate): Promise<void> {
    if (typeof update?.update_id === 'number') {
      // Telegram retries deliveries: process every update once
      const fresh = await this.redis.set(
        `tgv:upd:${bot.botKey}:${update.update_id}`,
        '1',
        'EX',
        3600,
        'NX',
      );
      if (fresh !== 'OK') return;
    }

    const msg = update?.message;
    if (
      !msg?.chat ||
      msg.chat.type !== 'private' ||
      !msg.from ||
      msg.from.is_bot
    )
      return;

    if (msg.contact) return this.onContact(bot, msg);

    const m = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec((msg.text ?? '').trim());
    if (m) return this.onStart(bot, msg, m[1]);
  }

  private async onStart(
    bot: TenantBot,
    msg: TelegramMessage,
    payload: string | undefined,
  ) {
    const chatId = msg.chat!.id;
    const fromId = String(msg.from!.id);
    const t = BOT_MESSAGES[pickBotLang(msg.from!.language_code)];

    if (!payload) return this.say(bot, chatId, t.greeting, REMOVE_KEYBOARD);

    const session = await this.load(payload);
    const ttl = session ? await this.redis.ttl(sKey(payload)) : 0;
    if (
      !session ||
      session.botKey !== bot.botKey ||
      session.status !== 'pending' ||
      ttl <= 0
    ) {
      return this.say(bot, chatId, t.expired, REMOVE_KEYBOARD);
    }
    if (session.tgUserId && session.tgUserId !== fromId) {
      return this.say(bot, chatId, t.wrongAccount, REMOVE_KEYBOARD);
    }

    await this.redis.set(uKey(bot.botKey, fromId), payload, 'EX', ttl);
    await this.say(bot, chatId, t.askContact(session.brand), {
      keyboard: [[{ text: t.shareButton, request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
  }

  private async onContact(bot: TenantBot, msg: TelegramMessage) {
    const chatId = msg.chat!.id;
    const fromId = String(msg.from!.id);
    const contact = msg.contact!;
    const t = BOT_MESSAGES[pickBotLang(msg.from!.language_code)];

    // A forwarded or hand-typed contact of somebody else proves nothing
    if (contact.user_id === undefined || String(contact.user_id) !== fromId) {
      return this.say(bot, chatId, t.notYourContact);
    }

    const sid = await this.redis.get(uKey(bot.botKey, fromId));
    const session = sid ? await this.load(sid) : null;
    if (!sid || !session || session.botKey !== bot.botKey) {
      return this.say(bot, chatId, t.expired, REMOVE_KEYBOARD);
    }
    if (session.status === 'verified')
      return this.say(bot, chatId, t.alreadyDone, REMOVE_KEYBOARD);

    const attempts = await this.redis.hincrby(sKey(sid), 'attempts', 1);
    if (attempts > MAX_CONTACT_ATTEMPTS) {
      await this.redis.del(sKey(sid));
      return this.say(bot, chatId, t.tooMany, REMOVE_KEYBOARD);
    }

    const phone = normalizeTelegramPhone(contact.phone_number);
    if (!isValidPhone(phone)) return this.say(bot, chatId, t.onlyUzbek);
    if (session.phoneExpected && session.phoneExpected !== phone) {
      return this.say(bot, chatId, t.phoneMismatch);
    }

    const ctx: RequestCtx = { ip: '', userAgent: 'telegram-webhook' };

    if (session.mode === 'instant') {
      // Defence in depth: the user-id lookup key already implies the binding
      if (session.tgUserId !== fromId)
        return this.say(bot, chatId, t.wrongAccount, REMOVE_KEYBOARD);
      await this.redis.hset(sKey(sid), { status: 'verified', phone });
      await this.events.log('telegram_verified', ctx, {
        tenantId: session.tenantId,
        phone,
        meta: { mode: 'instant' },
      });
      return this.say(bot, chatId, t.verified, REMOVE_KEYBOARD);
    }

    // code mode: same one-time code store as SMS, delivered into this verified chat
    try {
      await this.otp.issue(
        { id: session.tenantId, brandName: session.brand },
        phone,
        {
          alwaysDeliver: true,
          unavailableCode: 'telegram_unavailable',
          deliver: async (code) => {
            await this.client.call(bot.token, 'sendMessage', {
              chat_id: chatId,
              text: t.code(session.brand, code),
              parse_mode: 'HTML',
              reply_markup: REMOVE_KEYBOARD,
            });
          },
        },
      );
    } catch (err) {
      const rateLimited =
        err instanceof CustomerAuthException && err.code === 'rate_limited';
      return this.say(bot, chatId, rateLimited ? t.tooMany : t.failed);
    }
    await this.redis.hset(sKey(sid), { status: 'code_sent', phone });
    await this.events.log('telegram_verified', ctx, {
      tenantId: session.tenantId,
      phone,
      meta: { mode: 'code' },
    });
  }

  // ================= helpers =================

  private async load(sid: string): Promise<Session | null> {
    if (!SID_RE.test(sid)) return null;
    const h = await this.redis.hgetall(sKey(sid));
    if (!h?.tenantId) return null;
    return {
      tenantId: h.tenantId,
      botKey: h.botKey,
      brand: h.brand ?? '',
      mode: h.mode === 'instant' ? 'instant' : 'code',
      status: h.status as Session['status'],
      phoneExpected: h.phoneExpected || undefined,
      tgUserId: h.tgUserId || undefined,
      phone: h.phone || undefined,
      attempts: Number(h.attempts ?? 0),
    };
  }

  /** Sends a bot message; a failure here must never break the webhook response. */
  private async say(
    bot: TenantBot,
    chatId: number,
    text: string,
    replyMarkup?: Record<string, unknown>,
  ) {
    try {
      await this.client.call(bot.token, 'sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
    } catch (e) {
      this.logger.warn(`sendMessage failed: ${telegramErrorText(e)}`);
    }
  }
}
