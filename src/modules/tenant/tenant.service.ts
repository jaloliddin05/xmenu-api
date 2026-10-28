import { Injectable } from '@nestjs/common';
import { PrismaService } from '../_prisma/prisma.service';
import { CustomerAuthException } from '../auth/errors/customer-auth.exception';
import { isValidSlug } from '../organization/domain/slug';
import { parseTenantId } from './tenant-key';

export interface Tenant {
  id: string;
  slug: string;
  brandName: string;
}

const CACHE_TTL_MS = 30_000;

/** Tenant = organization. X-Tenant-Id carries organization.id (UUID); slugs are not accepted. */
@Injectable()
export class TenantService {
  private cache = new Map<
    string,
    { at: number; tenant: Tenant | null; active: boolean }
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
        select: { id: true, slug: true, name: true, is_active: true },
      });
      entry = {
        at: Date.now(),
        tenant: org
          ? { id: org.id, slug: org.slug ?? '', brandName: org.name }
          : null,
        active: !!org?.is_active,
      };
      if (this.cache.size > 1000) this.cache.clear();
      this.cache.set(id, entry);
    }

    if (!entry.tenant) throw new CustomerAuthException('tenant_not_found');
    if (!entry.active) throw new CustomerAuthException('tenant_inactive');
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

  /** Drops the cached entry after the owner changes something the tenant carries. */
  invalidate(id: string) {
    this.cache.delete(id);
  }
}
