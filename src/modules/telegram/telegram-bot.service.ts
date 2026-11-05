import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  decryptConfig,
  encryptConfig,
  parsePaymentConfigKey,
} from 'src/modules/payment/domain/payment-crypto';
import { errorMessage } from 'src/infra/helper/error-text';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';
import { hashWebhookSecret } from './domain/webhook-secret';
import type { BotSettingLeft } from './dto/telegram-bot-status.dto';
import { TelegramClient, telegramErrorText } from './telegram-client';
import {
  AppException,
  platformMisconfigured,
} from 'src/infra/errors/app-exception';

/** A venue's own bot, ready to use (token decrypted). `botKey` is the row id and never changes. */
export interface TenantBot {
  botKey: string;
  organizationId: string;
  username: string;
  token: string;
  /** sha256 hex of the webhook secret_token (domain/webhook-secret.ts) */
  webhookSecretHash: string;
}

export interface BotStatus {
  connected: boolean;
  username: string | null;
  link: string | null;
  webhookUrl: string | null;
  isEnabled: boolean;
}

export interface BotDisconnected {
  connected: false;
  leftOnBot: BotSettingLeft[];
}

/** Set by autoconfiguration (TelegramBotProfileService) and kept on the bot after disconnecting. */
const BOT_SETTINGS_LEFT: readonly BotSettingLeft[] = [
  'name',
  'description',
  'shortDescription',
  'commands',
];

interface BotRow {
  id: string;
  organization_id: string;
  telegram_bot_id: string;
  username: string;
  token_encrypted: string;
  webhook_secret_hash: string;
  is_enabled: boolean;
}

/** `<bot id>:<secret>` as issued by @BotFather. */
export const TELEGRAM_TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

const publicApiUrl = () =>
  (process.env.PUBLIC_API_URL ?? '').replace(/\/$/, '');

const invalidToken = () =>
  new AppException('invalid_bot_token', {
    message: 'Telegram did not accept the bot token',
  });

/**
 * Venues' own Telegram bots. Tokens are stored encrypted (same scheme and key as payment
 * providers). Webhooks use the row id, never the slug, so renaming a venue cannot break them.
 */
@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger('TelegramBot');
  private cachedKey?: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: TelegramClient,
    private readonly revalidate: RevalidateService,
  ) {}

  private get key(): Buffer {
    if (this.cachedKey) return this.cachedKey;
    try {
      return (this.cachedKey = parsePaymentConfigKey(
        process.env.PAYMENT_CONFIG_KEY,
      ));
    } catch {
      throw platformMisconfigured(
        'telegram_bot',
        'PAYMENT_CONFIG_KEY is not a 32-byte key: bot tokens cannot be stored',
      );
    }
  }

  private webhookUrl(botKey: string): string {
    return `${publicApiUrl()}/telegram/bot/${botKey}/webhook`;
  }

  private toTenantBot(row: BotRow): TenantBot {
    const { token } = decryptConfig<{ token: string }>(
      row.token_encrypted,
      this.key,
    );
    return {
      botKey: row.id,
      organizationId: row.organization_id,
      username: row.username,
      token,
      webhookSecretHash: row.webhook_secret_hash,
    };
  }

  /** The venue's enabled bot, or null if it has not connected one. */
  async forTenant(organizationId: string): Promise<TenantBot | null> {
    const row = await this.prisma.organization_telegram_bot.findUnique({
      where: { organization_id: organizationId },
    });
    return row && row.is_enabled ? this.toTenantBot(row) : null;
  }

  /** Used by the webhook route. */
  async byKey(botKey: string): Promise<TenantBot | null> {
    const row = await this.prisma.organization_telegram_bot.findUnique({
      where: { id: botKey },
    });
    return row && row.is_enabled ? this.toTenantBot(row) : null;
  }

  /**
   * Token that signs Mini App `initData` for this venue: its own bot, or the platform bot
   * (TELEGRAM_BOT_TOKEN) while the venue has not connected one.
   */
  async initDataToken(organizationId: string): Promise<string | null> {
    const bot = await this.forTenant(organizationId);
    return bot?.token ?? process.env.TELEGRAM_BOT_TOKEN ?? null;
  }

  async status(organizationId: string): Promise<BotStatus> {
    const row = await this.prisma.organization_telegram_bot.findUnique({
      where: { organization_id: organizationId },
    });
    if (!row) {
      return {
        connected: false,
        username: null,
        link: null,
        webhookUrl: null,
        isEnabled: false,
      };
    }
    return {
      connected: true,
      username: row.username,
      link: `https://t.me/${row.username}`,
      webhookUrl: this.webhookUrl(row.id),
      isEnabled: row.is_enabled,
    };
  }

  /** Validates the token with Telegram, registers the webhook, stores the token encrypted. */
  async connect(organizationId: string, rawToken: string): Promise<BotStatus> {
    const token = (rawToken ?? '').trim();
    if (!TELEGRAM_TOKEN_RE.test(token)) throw invalidToken();
    if (!publicApiUrl().startsWith('https://')) {
      // Telegram only delivers webhooks over HTTPS
      throw platformMisconfigured(
        'telegram_bot',
        'PUBLIC_API_URL is not https',
      );
    }
    // Fail before touching Telegram if tokens cannot be stored
    const key = this.key;

    let me: { id: number; is_bot: boolean; username?: string };
    try {
      me = await this.client.call(token, 'getMe');
    } catch {
      throw invalidToken();
    }
    if (!me?.is_bot || !me.username) throw invalidToken();

    const telegramBotId = String(me.id);
    const taken = await this.prisma.organization_telegram_bot.findUnique({
      where: { telegram_bot_id: telegramBotId },
    });
    if (taken && taken.organization_id !== organizationId) {
      throw new AppException('bot_already_connected', {
        message: 'This bot is connected to another venue',
      });
    }

    const existing = await this.prisma.organization_telegram_bot.findUnique({
      where: { organization_id: organizationId },
    });
    const id = existing?.id ?? randomUUID();
    const webhookSecret = randomBytes(32).toString('hex');

    // Webhook first: if Telegram refuses it, nothing is stored and the old setup keeps working
    try {
      await this.client.call(token, 'setWebhook', {
        url: this.webhookUrl(id),
        secret_token: webhookSecret,
        allowed_updates: ['message'],
        drop_pending_updates: true,
      });
    } catch (e) {
      this.logger.warn(
        `setWebhook failed for organization ${organizationId}: ${telegramErrorText(e)}`,
      );
      throw new AppException('webhook_setup_failed', {
        message: 'Telegram refused the webhook',
      });
    }

    const data = {
      telegram_bot_id: telegramBotId,
      username: me.username,
      token_encrypted: encryptConfig({ token }, key),
      webhook_secret_hash: hashWebhookSecret(webhookSecret),
      is_enabled: true,
    };
    await this.prisma.organization_telegram_bot.upsert({
      where: { organization_id: organizationId },
      create: { id, organization_id: organizationId, ...data },
      update: data,
    });

    // The venue switched to a different bot: stop the old one from calling us
    if (existing && existing.telegram_bot_id !== telegramBotId) {
      await this.dropWebhook(existing);
    }
    await this.authChannelsChanged(organizationId);
    return this.status(organizationId);
  }

  /**
   * Drops the webhook and the row, gives the menu button back to Telegram's default. The bot's
   * name, descriptions and commands are the owner's settings on their own bot and stay as they are.
   */
  async disconnect(organizationId: string): Promise<BotDisconnected> {
    const row = await this.prisma.organization_telegram_bot.findUnique({
      where: { organization_id: organizationId },
    });
    if (!row) return { connected: false, leftOnBot: [] };
    await this.resetMenuButton(row);
    await this.dropWebhook(row);
    await this.prisma.organization_telegram_bot.delete({
      where: { organization_id: organizationId },
    });
    await this.authChannelsChanged(organizationId);
    return { connected: false, leftOnBot: [...BOT_SETTINGS_LEFT] };
  }

  /** GET /tenant/config channels.auth.telegram follows the bot row; front-ends cache that config. */
  private async authChannelsChanged(organizationId: string) {
    try {
      await this.revalidate.addRevalidationJob({
        tenantId: organizationId,
        route: 'channels',
      });
    } catch (e) {
      // The bot is already saved; a failed cache nudge must not fail the request (ISR expires on its own)
      this.logger.warn(
        `Revalidation after a bot change failed: ${errorMessage(e)}`,
      );
    }
  }

  /** The bot is no longer ours: give its menu button back to Telegram's default. Best effort. */
  private async resetMenuButton(row: BotRow) {
    try {
      const bot = this.toTenantBot(row);
      await this.client.call(bot.token, 'setChatMenuButton', {
        menu_button: { type: 'default' },
      });
    } catch (e) {
      this.logger.warn(
        `setChatMenuButton reset failed: ${telegramErrorText(e)}`,
      );
    }
  }

  private async dropWebhook(row: BotRow) {
    try {
      const bot = this.toTenantBot(row);
      await this.client.call(bot.token, 'deleteWebhook');
    } catch (e) {
      this.logger.warn(`deleteWebhook failed: ${telegramErrorText(e)}`);
    }
  }
}
