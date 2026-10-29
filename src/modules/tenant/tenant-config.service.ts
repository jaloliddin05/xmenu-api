import { Injectable, Logger } from '@nestjs/common';
import type { Lang } from 'src/infra/http/request-helpers';
import { publicFileUrl } from 'src/modules/menu/menu.mapper';
import { CustomerAuthException } from 'src/modules/auth/errors/customer-auth.exception';
import { OrderSettingsService } from 'src/modules/order/services/order-settings.service';
import { toSettingsView } from 'src/modules/organization/domain/organization-settings';
import { PrismaService } from '../_prisma/prisma.service';
import { FulfillmentMode, TenantConfigDto } from './dto/tenant-config.dto';
import type { Tenant } from './tenant.service';

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

/** Modes a customer can actually order with: delivery also needs a delivery zone (order.service.ts). */
export function fulfillmentModes(
  branches: { accepts_delivery: boolean; accepts_pickup: boolean }[],
  hasDeliveryZone: boolean,
): FulfillmentMode[] {
  const modes: FulfillmentMode[] = [];
  if (hasDeliveryZone && branches.some((b) => b.accepts_delivery))
    modes.push('delivery');
  if (branches.some((b) => b.accepts_pickup)) modes.push('pickup');
  return modes;
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
        },
      }),
      this.orderSettings.get(tenant.id),
      this.prisma.branch.findMany({
        where: { organization_id: tenant.id, is_active: true },
        select: { accepts_delivery: true, accepts_pickup: true },
      }),
    ]);
    if (!org) throw new CustomerAuthException('tenant_not_found');
    if (!org.settings) {
      this.logger.error(
        `organization_settings row missing for organization ${tenant.id}`,
      );
      throw new CustomerAuthException(
        'settings_missing',
        'Venue settings are missing',
      );
    }

    const s = toSettingsView(org.settings);
    const modes = fulfillmentModes(branches, ordering.deliveryZone !== null);
    return {
      id: org.id,
      slug: org.slug ?? '',
      name: org.name,
      type: org.type,
      logoUrl: publicFileUrl(org.logo?.url),
      bannerUrl: publicFileUrl(org.banner?.url),
      description: pickDescription(org.translations, lang, s.defaultLanguage),
      foundedYear: s.foundedYear,
      theme: s.theme,
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
      fulfillment: { modes, defaultMode: modes[0] ?? null },
      map: {
        center: s.mapCenter ? [s.mapCenter.lat, s.mapCenter.lng] : null,
        zoom: s.mapZoom,
        city: s.city,
        bounds: s.mapBounds,
        deliveryZone: ordering.deliveryZone,
      },
    };
  }
}
