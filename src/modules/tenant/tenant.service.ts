import { Injectable } from '@nestjs/common';
import { PrismaService } from '../_prisma/prisma.service';
import { CustomerAuthException } from '../auth/errors/customer-auth.exception';

export interface Tenant {
  id: string;
  slug: string;
  brandName: string;
}

const CACHE_TTL_MS = 30_000;

/** Tenant = organization. X-Tenant-Id sarlavhasi organization.slug ni bildiradi. */
@Injectable()
export class TenantService {
  private cache = new Map<string, { at: number; tenant: Tenant | null; active: boolean }>();

  constructor(private readonly prisma: PrismaService) {}

  async resolve(slug: string): Promise<Tenant> {
    const hit = this.cache.get(slug);
    let entry = hit && Date.now() - hit.at < CACHE_TTL_MS ? hit : undefined;

    if (!entry) {
      const org = await this.prisma.organization.findUnique({
        where: { slug },
        select: { id: true, slug: true, name: true, is_active: true },
      });
      entry = {
        at: Date.now(),
        tenant: org ? { id: org.id, slug: org.slug!, brandName: org.name } : null,
        active: !!org?.is_active,
      };
      if (this.cache.size > 1000) this.cache.clear();
      this.cache.set(slug, entry);
    }

    if (!entry.tenant) throw new CustomerAuthException('tenant_not_found');
    if (!entry.active) throw new CustomerAuthException('tenant_inactive');
    return entry.tenant;
  }
}
