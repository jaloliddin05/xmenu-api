import { Injectable, Logger } from '@nestjs/common';
import { isLang, Lang } from 'src/infra/http/request-helpers';
import { PrismaService } from '../_prisma/prisma.service';
import { CustomerAuthException } from '../auth/errors/customer-auth.exception';
import { isValidSlug } from '../organization/domain/slug';
import {
  isPlatformHost,
  normalizeHost,
  platformDomainFrom,
  platformSlug,
} from './host';
import { PRIMARY_DOMAIN_SELECT, primaryDomainOf } from './primary-domain';
import { parseTenantId } from './tenant-key';

/** GET /tenant/by-host answer. */
export interface TenantHostRef {
  id: string;
  slug: string | null;
  name: string;
  primaryDomain: string | null;
}

const HOST_ORG_SELECT = {
  id: true,
  slug: true,
  name: true,
  is_active: true,
  domains: PRIMARY_DOMAIN_SELECT,
} as const;

export interface Tenant {
  id: string;
  slug: string;
  brandName: string;
  /** From organization_settings: response language when the request asks for none of `languages`. */
  defaultLanguage: Lang;
  languages: Lang[];
  currency: string;
}

const CACHE_TTL_MS = 30_000;

/** Tenant = organization. X-Tenant-Id carries organization.id (UUID); slugs are not accepted. */
@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);
  private cache = new Map<
    string,
    { at: number; found: boolean; active: boolean; tenant: Tenant | null }
  >();

  constructor(private readonly prisma: PrismaService) {}

  async resolve(key: string): Promise<Tenant> {
    const id = parseTenantId(key);
    if (!id) throw new CustomerAuthException('tenant_not_found');

    const hit = this.cache.get(id);
    let entry = hit && Date.now() - hit.at < CACHE_TTL_MS ? hit : undefined;

    if (!entry) {
      const org = await this.prisma.organization.findUnique({
        where: { id },
        select: {
          id: true,
          slug: true,
          name: true,
          is_active: true,
          settings: {
            select: { default_language: true, languages: true, currency: true },
          },
        },
      });
      entry = {
        at: Date.now(),
        found: !!org,
        active: !!org?.is_active,
        tenant: org?.settings
          ? {
              id: org.id,
              slug: org.slug ?? '',
              brandName: org.name,
              defaultLanguage: org.settings.default_language as Lang,
              languages: org.settings.languages.filter(isLang),
              currency: org.settings.currency,
            }
          : null,
      };
      if (this.cache.size > 1000) this.cache.clear();
      this.cache.set(id, entry);
    }

    if (!entry.found) throw new CustomerAuthException('tenant_not_found');
    if (!entry.active) throw new CustomerAuthException('tenant_inactive');
    // The settings row is created at signup; a missing one is a data bug, not a default
    if (!entry.tenant) {
      this.logger.error(
        `organization_settings row missing for organization ${id}`,
      );
      throw new CustomerAuthException(
        'settings_missing',
        'Venue settings are missing',
      );
    }
    return entry.tenant;
  }

  /** Public lookup for front-ends: turns the (renameable) URL slug into the stable tenant id. */
  async findActiveBySlug(
    slug: string,
  ): Promise<{ id: string; slug: string } | null> {
    if (!isValidSlug(slug)) return null;
    const org = await this.prisma.organization.findUnique({
      where: { slug },
      select: { id: true, slug: true, is_active: true },
    });
    if (!org?.is_active) return null;
    return { id: org.id, slug: org.slug ?? slug };
  }

  /**
   * Public lookup for the delivery site: the host it was requested on → the venue. A host is a tenant
   * only as {slug}.PLATFORM_DOMAIN (by slug, no table row) or as a verified tenant_domain; a pending,
   * unknown or other platform host (api.xmenu.uz, a.b.xmenu.uz) and an inactive venue give null.
   */
  async findActiveByHost(raw: string): Promise<TenantHostRef | null> {
    const host = normalizeHost(raw);
    if (!host) return null;
    const platformDomain = platformDomainFrom();

    let org: {
      id: string;
      slug: string | null;
      name: string;
      is_active: boolean;
      domains: { host: string }[];
    } | null = null;
    if (isPlatformHost(host, platformDomain)) {
      const slug = platformSlug(host, platformDomain);
      if (!slug || !isValidSlug(slug)) return null;
      org = await this.prisma.organization.findUnique({
        where: { slug },
        select: HOST_ORG_SELECT,
      });
    } else {
      // verified_host is set only while the domain is verified
      const domain = await this.prisma.tenant_domain.findUnique({
        where: { verified_host: host },
        select: { organization: { select: HOST_ORG_SELECT } },
      });
      org = domain?.organization ?? null;
    }
    if (!org?.is_active) return null;
    return {
      id: org.id,
      slug: org.slug,
      name: org.name,
      primaryDomain: primaryDomainOf(org.domains),
    };
  }

  /** Drops the cached entry after the owner changes something the tenant carries. */
  invalidate(id: string) {
    this.cache.delete(id);
  }
}
