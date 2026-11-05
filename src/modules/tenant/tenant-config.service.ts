import { Injectable, Logger } from '@nestjs/common';
import type { Lang } from 'src/infra/http/request-helpers';
import { publicFileUrl } from 'src/modules/menu/menu.mapper';
import { OrderSettingsService } from 'src/modules/order/services/order-settings.service';
import {
  resolveTheme,
  toSettingsView,
} from 'src/modules/organization/domain/organization-settings';
import { orderingProblem } from 'src/modules/organization/domain/publication';
import type { OrderingProblem } from 'src/modules/organization/domain/publication';
import { isSmsConfigured } from 'src/modules/sms/sms.module';
import { PrismaService } from '../_prisma/prisma.service';
import {
  DeliveryUnavailableReason,
  FulfillmentMode,
  TenantAuthChannelsDto,
  TenantConfigDto,
  TenantFulfillmentDto,
} from './dto/tenant-config.dto';
import { resolveMapView } from './map-view';
import { PRIMARY_DOMAIN_SELECT, primaryDomainOf } from './primary-domain';
import type { LatLng } from 'src/modules/organization/domain/organization-settings';
import type { Tenant } from './tenant.service';
import { AppException } from 'src/infra/errors/app-exception';

/** Description in the response language, else in the venue's default language; blank counts as missing. */
export function pickDescription(
  translations: { lang: string; description: string }[],
  lang: Lang,
  fallback: Lang,
): string | null {
  for (const l of [lang, fallback]) {
    const text = translations.find((t) => t.lang === l)?.description.trim();
    if (text) return text;
  }
  return null;
}

/**
 * Modes a customer can actually order with (order.service.ts): none while ordering is off or not
 * published (domain/publication.ts), delivery also needs a delivery zone.
 */
export function fulfillmentModes(
  branches: { accepts_delivery: boolean; accepts_pickup: boolean }[],
  hasDeliveryZone: boolean,
  ordering = true,
): FulfillmentMode[] {
  const modes: FulfillmentMode[] = [];
  if (!ordering) return modes;
  if (hasDeliveryZone && branches.some((b) => b.accepts_delivery))
    modes.push('delivery');
  if (branches.some((b) => b.accepts_pickup)) modes.push('pickup');
  return modes;
}

/**
 * Whether delivery can be ordered and, when not, the first reason in this order: no branch takes
 * delivery, ordering is off, not published, no delivery zone. Mirrors fulfillmentModes.
 */
export function deliveryStatus(
  branches: { accepts_delivery: boolean }[],
  hasDeliveryZone: boolean,
  problem: OrderingProblem | null,
): Pick<
  TenantFulfillmentDto,
  'deliveryOffered' | 'deliveryAvailable' | 'deliveryUnavailableReason'
> {
  const deliveryOffered = branches.some((b) => b.accepts_delivery);
  let reason: DeliveryUnavailableReason | null = null;
  if (!deliveryOffered) reason = 'not_offered';
  else if (problem === 'ordering_channel_disabled') reason = 'channel_disabled';
  else if (problem === 'ordering_not_published') reason = 'not_published';
  else if (!hasDeliveryZone) reason = 'no_zone';
  return {
    deliveryOffered,
    deliveryAvailable: reason === null,
    deliveryUnavailableReason: reason,
  };
}

/**
 * How a customer can confirm a phone. telegram mirrors TelegramBotService.forTenant (an enabled
 * bot row), so the hint and POST /auth/customer/telegram/start agree.
 */
export function authChannels(
  bot: { is_enabled: boolean } | null,
  smsConfigured: boolean,
): TenantAuthChannelsDto {
  return { sms: smsConfigured, telegram: bot?.is_enabled === true };
}

/** Branch coordinates for the map; (0, 0) is what an empty map pin gives, not a real place. */
export function branchPoints(
  branches: { latitude?: number | null; longitude?: number | null }[],
): LatLng[] {
  const points: LatLng[] = [];
  for (const { latitude, longitude } of branches) {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') continue;
    if (latitude === 0 && longitude === 0) continue;
    points.push([latitude, longitude]);
  }
  return points;
}

@Injectable()
export class TenantConfigService {
  private readonly logger = new Logger(TenantConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderSettings: OrderSettingsService,
  ) {}

  async get(tenant: Tenant, lang: Lang): Promise<TenantConfigDto> {
    const [org, ordering, branches] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: tenant.id },
        select: {
          id: true,
          slug: true,
          name: true,
          type: true,
          logo: { select: { url: true } },
          banner: { select: { url: true } },
          translations: { select: { lang: true, description: true } },
          settings: true,
          qr_enabled: true,
          delivery_enabled: true,
          delivery_mode: true,
          published_at: true,
          telegram_bot: { select: { is_enabled: true } },
          domains: PRIMARY_DOMAIN_SELECT,
        },
      }),
      this.orderSettings.get(tenant.id),
      this.prisma.branch.findMany({
        where: { organization_id: tenant.id, is_active: true },
        select: {
          accepts_delivery: true,
          accepts_pickup: true,
          latitude: true,
          longitude: true,
        },
      }),
    ]);
    if (!org) throw new AppException('tenant_not_found');
    if (!org.settings) {
      this.logger.error(
        `organization_settings row missing for organization ${tenant.id}`,
      );
      throw new AppException('settings_missing', {
        message: 'Venue settings are missing',
      });
    }

    const s = toSettingsView(org.settings);
    const problem = orderingProblem({
      deliveryEnabled: org.delivery_enabled,
      publishedAt: org.published_at,
    });
    const published = problem === null;
    const modes = fulfillmentModes(
      branches,
      ordering.deliveryZone !== null,
      published,
    );
    const view = resolveMapView(
      { center: s.mapCenter, zoom: s.mapZoom },
      ordering.deliveryZone,
      branchPoints(branches),
    );
    return {
      id: org.id,
      slug: org.slug ?? '',
      name: org.name,
      primaryDomain: primaryDomainOf(org.domains),
      type: org.type,
      logoUrl: publicFileUrl(org.logo?.url),
      bannerUrl: publicFileUrl(org.banner?.url),
      description: pickDescription(org.translations, lang, s.defaultLanguage),
      foundedYear: s.foundedYear,
      theme: resolveTheme(s.theme),
      locale: {
        defaultLanguage: s.defaultLanguage,
        languages: s.languages,
        currency: s.currency,
      },
      contacts: {
        phone: s.supportPhone,
        telegramUsername: s.supportTelegram,
        workingHours: s.supportHours,
        address: s.address,
      },
      channels: {
        qr: org.qr_enabled,
        auth: authChannels(org.telegram_bot, isSmsConfigured()),
        delivery: {
          enabled: org.delivery_enabled,
          mode: org.delivery_mode,
          published,
        },
      },
      fulfillment: {
        modes,
        defaultMode: modes[0] ?? null,
        ...deliveryStatus(branches, ordering.deliveryZone !== null, problem),
      },
      map: {
        center: view.center,
        centerSource: view.centerSource,
        zoom: view.zoom,
        city: s.city,
        bounds: s.mapBounds,
        deliveryZone: ordering.deliveryZone,
      },
    };
  }
}
