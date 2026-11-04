import { Prisma } from '@prisma/client';

/**
 * The venue's primary own domain: the earliest verified one (ties by host). Nested select on
 * `organization.domains`, so every answer that shows primaryDomain applies the same rule.
 */
export const PRIMARY_DOMAIN_SELECT = {
  where: { status: 'verified' },
  orderBy: [{ verified_at: 'asc' }, { host: 'asc' }],
  take: 1,
  select: { host: true },
} satisfies Prisma.tenant_domainFindManyArgs;

export function primaryDomainOf(
  domains: { host: string }[] | undefined,
): string | null {
  return domains?.[0]?.host ?? null;
}
