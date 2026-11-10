import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { errorMessage } from 'src/infra/helper/error-text';
import { REDIS } from 'src/infra/redis/redis.module';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { OpsNotifierService } from 'src/modules/order/notifications/ops-notifier.service';
import { TelegramBotService } from 'src/modules/telegram/telegram-bot.service';
import {
  GuestLoginMethods,
  hasGuestLogin,
  smsLoginAvailable,
} from './guest-login';

/** One ops alert per venue per hour while its customers cannot sign in. */
export const NO_LOGIN_ALERT_TTL_SECONDS = 3600;
const alertKey = (organizationId: string) =>
  `ops:guest-login-unavailable:${organizationId}`;

/**
 * Sign-in methods of a venue's customers, for GET /auth/customer/methods, GET /tenant/config
 * (channels.auth) and the publication warnings. A live venue (ordering on and published) without
 * any method is reported to the log and the ops chat, at most once an hour per venue.
 */
@Injectable()
export class GuestLoginService {
  private readonly logger = new Logger('GuestLogin');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bots: TelegramBotService,
    private readonly ops: OpsNotifierService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** `live`: whether the venue takes orders, when the caller already knows; otherwise it is read. */
  async methods(
    organizationId: string,
    live?: boolean,
  ): Promise<GuestLoginMethods> {
    const methods: GuestLoginMethods = {
      sms: smsLoginAvailable(),
      telegram: await this.bots.usable(organizationId),
    };
    if (!hasGuestLogin(methods)) await this.reportNoLogin(organizationId, live);
    return methods;
  }

  private async reportNoLogin(organizationId: string, live?: boolean) {
    try {
      if (!(live ?? (await this.isLive(organizationId)))) return;
      const first = await this.redis.set(
        alertKey(organizationId),
        '1',
        'EX',
        NO_LOGIN_ALERT_TTL_SECONDS,
        'NX',
      );
      if (first !== 'OK') return;
      await this.ops.alert(
        `Venue ${organizationId} is published but its customers cannot sign in: platform SMS is not configured and the venue bot is not usable (not connected, disabled or its token cannot be decrypted)`,
      );
    } catch (e) {
      // Reporting must never break the page that asked for the methods
      this.logger.warn(
        `No-login report for organization ${organizationId} failed: ${errorMessage(e)}`,
      );
    }
  }

  private async isLive(organizationId: string): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { delivery_enabled: true, published_at: true },
    });
    return !!org?.delivery_enabled && org.published_at !== null;
  }
}
