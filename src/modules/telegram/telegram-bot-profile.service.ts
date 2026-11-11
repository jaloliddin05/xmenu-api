import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Lang, isLang } from 'src/infra/http/request-helpers';
import { fieldErrorsException } from 'src/infra/validators/validation-errors';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  BOT_START_COMMAND,
  BotProfileFields,
  SyncItem,
  SyncResult,
  VenueFacts,
  miniAppUrl,
  resolveProfile,
  validateProfileInput,
} from './domain/bot-profile';
import { TelegramBotService, TenantBot } from './telegram-bot.service';
import { TelegramClient, telegramErrorText } from './telegram-client';
import { AppException } from 'src/infra/errors/app-exception';
import type { DeliveryMode } from 'src/modules/organization/domain/publication';
import {
  PRIMARY_DOMAIN_SELECT,
  primaryDomainOf,
} from 'src/modules/tenant/primary-domain';

export interface BotProfileView {
  /** One entry per venue language */
  profile: Record<Lang, BotProfileFields>;
  /** false once the owner has saved the profile */
  isDefault: boolean;
  /**
   * Address the menu button and the /start button open: the primary own domain, else the platform address
   * (DELIVERY_URL_TEMPLATE). null in mode site (the button is Telegram's default) or when no address can be built
   */
  deliveryUrl: string | null;
  lastSync: { syncedAt: Date; result: SyncResult } | null;
}

interface Venue extends VenueFacts {
  slug: string | null;
  primaryDomain: string | null;
  mode: DeliveryMode;
  languages: Lang[];
}

const ok = (): SyncItem => ({ status: 'ok' });

/**
 * Pushes the venue's profile to its own bot through the Bot API: name, descriptions and the
 * /start command per language, and the menu button that opens the delivery site as a Mini App.
 * Each item is independent: a failure (Telegram rate-limits name changes) is reported per item
 * and never undoes the others. Telegram's text is returned, the bot token never is.
 */
@Injectable()
export class TelegramBotProfileService {
  private readonly logger = new Logger('TelegramBotProfile');

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: TelegramClient,
    private readonly bots: TelegramBotService,
  ) {}

  private async venue(organizationId: string): Promise<Venue> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        name: true,
        slug: true,
        delivery_mode: true,
        domains: PRIMARY_DOMAIN_SELECT,
        translations: { select: { lang: true, description: true } },
        settings: { select: { languages: true, default_language: true } },
      },
    });
    if (!org?.settings)
      throw new AppException('not_found', {
        message: 'Organization not found',
      });
    const languages = org.settings.languages.filter(isLang);
    const defaultLanguage = isLang(org.settings.default_language)
      ? org.settings.default_language
      : languages[0];
    return {
      name: org.name,
      slug: org.slug,
      primaryDomain: primaryDomainOf(org.domains),
      mode: org.delivery_mode,
      languages,
      defaultLanguage,
      descriptions: Object.fromEntries(
        org.translations.map((t) => [t.lang, t.description]),
      ),
    };
  }

  private async row(organizationId: string) {
    const row = await this.prisma.organization_telegram_bot.findUnique({
      where: { organization_id: organizationId },
    });
    if (!row) {
      throw new AppException('bot_not_connected', {
        message: 'The venue has no connected Telegram bot',
      });
    }
    return row;
  }

  /** Connection status with the profile; without a bot the profile part is empty. */
  async fullStatus(organizationId: string) {
    const status = await this.bots.status(organizationId);
    if (!status.connected) {
      return {
        ...status,
        profile: null,
        isDefault: true,
        deliveryUrl: null,
        lastSync: null,
      };
    }
    return { ...status, ...(await this.view(organizationId)) };
  }

  /** Profile as the owner sees it: saved values over the defaults, plus the last push result. */
  async view(organizationId: string): Promise<BotProfileView> {
    const [row, venue] = await Promise.all([
      this.row(organizationId),
      this.venue(organizationId),
    ]);
    return {
      profile: resolveProfile(row.profile, venue.languages, venue),
      isDefault: row.profile == null,
      deliveryUrl: miniAppUrl(venue),
      lastSync:
        row.synced_at && row.sync_result
          ? {
              syncedAt: row.synced_at,
              result: row.sync_result as unknown as SyncResult,
            }
          : null,
    };
  }

  /** Validates and stores the owner's profile, then pushes it to Telegram. */
  async save(organizationId: string, input: unknown): Promise<BotProfileView> {
    await this.row(organizationId);
    const venue = await this.venue(organizationId);
    const checked = validateProfileInput(input, venue.languages);
    if ('errors' in checked) {
      throw fieldErrorsException('validation_error', checked.errors);
    }
    // Languages the owner did not send keep their defaults, so store the complete resolved set
    const complete = resolveProfile(checked.profile, venue.languages, venue);
    await this.prisma.organization_telegram_bot.update({
      where: { organization_id: organizationId },
      data: { profile: complete as unknown as Prisma.InputJsonValue },
    });
    await this.apply(organizationId);
    return this.view(organizationId);
  }

  /** Pushes the stored (or default) profile to the venue's bot and records the outcome. */
  async apply(organizationId: string): Promise<SyncResult> {
    const bot = await this.bots.forTenant(organizationId);
    if (!bot) {
      throw new AppException('bot_not_connected', {
        message: 'The venue has no connected Telegram bot',
      });
    }
    const [row, venue] = await Promise.all([
      this.row(organizationId),
      this.venue(organizationId),
    ]);
    const profile = resolveProfile(row.profile, venue.languages, venue);

    const result: SyncResult = {
      name: await this.perLanguage(bot, venue, profile, 'setMyName', (f) => ({
        name: f.name,
      })),
      description: await this.perLanguage(
        bot,
        venue,
        profile,
        'setMyDescription',
        (f) => ({ description: f.description }),
      ),
      shortDescription: await this.perLanguage(
        bot,
        venue,
        profile,
        'setMyShortDescription',
        (f) => ({ short_description: f.shortDescription }),
      ),
      commands: await this.perLanguage(
        bot,
        venue,
        profile,
        'setMyCommands',
        (_f, lang) => ({
          commands: [
            { command: 'start', description: BOT_START_COMMAND[lang] },
          ],
        }),
      ),
      menuButton: await this.menuButton(
        bot,
        venue,
        profile[venue.defaultLanguage]?.menuButtonText,
      ),
    };
    await this.record(organizationId, result);
    return result;
  }

  /**
   * Mini App address for the /start greeting button: null in mode site or when it cannot be built.
   * Never throws.
   */
  async startUrl(organizationId: string): Promise<string | null> {
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          slug: true,
          delivery_mode: true,
          domains: PRIMARY_DOMAIN_SELECT,
        },
      });
      if (!org) return null;
      return miniAppUrl({
        slug: org.slug,
        primaryDomain: primaryDomainOf(org.domains),
        mode: org.delivery_mode,
      });
    } catch {
      return null;
    }
  }

  /**
   * Only the menu button, after what it depends on changed: delivery mode, slug, primary domain.
   * Sends the whole wanted state every time, so repeating it is harmless. Never throws.
   */
  async syncMenuButton(organizationId: string): Promise<void> {
    try {
      const bot = await this.bots.forTenant(organizationId);
      if (!bot) return;
      const [row, venue] = await Promise.all([
        this.row(organizationId),
        this.venue(organizationId),
      ]);
      const profile = resolveProfile(row.profile, venue.languages, venue);
      const item = await this.menuButton(
        bot,
        venue,
        profile[venue.defaultLanguage]?.menuButtonText,
      );
      const previous = (row.sync_result ?? {}) as Partial<SyncResult>;
      await this.record(organizationId, {
        name: previous.name ?? ok(),
        description: previous.description ?? ok(),
        shortDescription: previous.shortDescription ?? ok(),
        commands: previous.commands ?? ok(),
        menuButton: item,
      });
    } catch (e) {
      this.logger.warn(
        `menu button refresh failed for ${organizationId}: ${telegramErrorText(e)}`,
      );
    }
  }

  /** Calls `method` once per venue language and once without `language_code` for the default language. */
  private async perLanguage(
    bot: TenantBot,
    venue: Venue,
    profile: Record<Lang, BotProfileFields>,
    method: string,
    payload: (fields: BotProfileFields, lang: Lang) => Record<string, unknown>,
  ): Promise<SyncItem> {
    const targets: { lang: Lang; code?: string }[] = [
      { lang: venue.defaultLanguage },
      ...venue.languages.map((lang) => ({ lang, code: lang })),
    ];
    const failures: string[] = [];
    await Promise.all(
      targets.map(async ({ lang, code }) => {
        try {
          await this.client.call(bot.token, method, {
            ...payload(profile[lang], lang),
            ...(code ? { language_code: code } : {}),
          });
        } catch (e) {
          failures.push(code ?? 'default');
          this.logger.warn(
            `${method} (${code ?? 'default'}) failed for bot ${bot.botKey}: ${telegramErrorText(e)}`,
          );
        }
      }),
    );
    return failures.length
      ? { status: 'failed', code: 'telegram_request_failed' }
      : ok();
  }

  /** Mode site: Telegram's default button; otherwise a web_app button to the Mini App address. */
  private async menuButton(
    bot: TenantBot,
    venue: Venue,
    text: string | undefined,
  ): Promise<SyncItem> {
    if (venue.mode === 'site') {
      try {
        await this.client.call(bot.token, 'setChatMenuButton', {
          menu_button: { type: 'default' },
        });
        return ok();
      } catch (e) {
        this.logger.warn(
          `setChatMenuButton (default) failed for bot ${bot.botKey}: ${telegramErrorText(e)}`,
        );
        return { status: 'failed', code: 'telegram_request_failed' };
      }
    }
    const url = miniAppUrl(venue);
    if (!url)
      return {
        status: 'skipped',
        code: 'platform_misconfigured',
        feature: 'delivery_link',
      };
    try {
      await this.client.call(bot.token, 'setChatMenuButton', {
        menu_button: {
          type: 'web_app',
          text: text || 'Menu',
          web_app: { url },
        },
      });
      return ok();
    } catch (e) {
      this.logger.warn(
        `setChatMenuButton failed for bot ${bot.botKey}: ${telegramErrorText(e)}`,
      );
      return { status: 'failed', code: 'telegram_request_failed' };
    }
  }

  private async record(organizationId: string, result: SyncResult) {
    await this.prisma.organization_telegram_bot.update({
      where: { organization_id: organizationId },
      data: {
        synced_at: new Date(),
        sync_result: result as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
