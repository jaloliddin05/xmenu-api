import { Injectable } from '@nestjs/common';
import { AppException } from 'src/infra/errors/app-exception';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import {
  deliveryModeProblem,
  initDataChecked,
} from 'src/modules/organization/domain/delivery-mode';
import type { InitDataState } from 'src/modules/organization/domain/delivery-mode';
import type { DeliveryMode } from 'src/modules/organization/domain/publication';
import { TelegramBotService } from 'src/modules/telegram/telegram-bot.service';
import { TelegramInitDataService } from './telegram-init-data.service';
import type { TelegramUser } from './telegram-init-data.service';

/** Header with the raw `Telegram.WebApp.initData` of the venue's Mini App. */
export const INIT_DATA_HEADER = 'x-telegram-init-data';

/** A request that came from the venue's Mini App: the guest and the venue bot that signed the initData. */
export interface MiniAppVisit {
  user: TelegramUser;
  telegramBotId: string;
}

/**
 * Applies the venue's delivery mode to a guest request (sign-in and POST /orders):
 * docs/TELEGRAM_VERIFICATION.md, "Mini App и режимы доставки". The initData is checked only
 * against the venue's own bot, never the platform bot: only that bot opens the venue's Mini App.
 */
@Injectable()
export class MiniAppAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bots: TelegramBotService,
    private readonly initData: TelegramInitDataService,
  ) {}

  /**
   * Throws miniapp_required / miniapp_init_data_invalid (403), or telegram_unavailable when the mode
   * needs the venue bot and it is gone. Returns the Telegram user of a checked header, else null.
   * `mode`: the venue's delivery mode when the caller has already read it; otherwise it is read fresh.
   */
  async assert(
    organizationId: string,
    header: string | undefined,
    mode?: DeliveryMode,
  ): Promise<TelegramUser | null> {
    return (await this.check(organizationId, header, mode))?.user ?? null;
  }

  /** Same as assert(), but also says which venue bot signed the initData (POST /orders keeps it). */
  async check(
    organizationId: string,
    header: string | undefined,
    mode?: DeliveryMode,
  ): Promise<MiniAppVisit | null> {
    const deliveryMode = mode ?? (await this.mode(organizationId));
    const raw = header?.trim() || undefined;
    if (!initDataChecked(deliveryMode, raw)) return null;

    // The bot was removed while the mode stayed (DELETE /telegram-bot keeps it): no Mini App to open
    const bot = await this.bots.forTenant(organizationId);
    if (!bot) {
      throw new AppException('telegram_unavailable', {
        message: 'The venue Mini App needs its Telegram bot',
      });
    }

    let user: TelegramUser | null = null;
    let state: InitDataState = 'absent';
    if (raw) {
      try {
        user = this.initData.verifyWithToken(raw, bot.token);
        state = 'valid';
      } catch (e) {
        if (!(e instanceof AppException)) throw e;
        state = 'invalid';
      }
    }

    const problem = deliveryModeProblem(deliveryMode, state);
    if (problem === 'miniapp_required') {
      throw new AppException(problem, {
        message: 'Open the venue in Telegram',
      });
    }
    if (problem) {
      throw new AppException(problem, {
        message: 'Reopen the venue Mini App in Telegram',
      });
    }
    return user ? { user, telegramBotId: bot.telegramBotId } : null;
  }

  private async mode(organizationId: string): Promise<DeliveryMode> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { delivery_mode: true },
    });
    return org?.delivery_mode ?? 'site';
  }
}
