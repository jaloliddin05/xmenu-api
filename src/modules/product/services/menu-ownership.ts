import { NotFoundException } from '@nestjs/common';

/**
 * Prisma `where` fragments that tie a menu row to the caller's organization. Categories and option
 * groups carry organization_id; dishes and options inherit it from their parent. A group created
 * before this column existed and never attached to a dish has no owner and is never matched.
 */
export const ownCategory = (organizationId: string) => ({ organization_id: organizationId });

export const ownProduct = (organizationId: string) => ({ category: ownCategory(organizationId) });

export const ownGroup = (organizationId: string) => ({ organization_id: organizationId });

export const ownOption = (organizationId: string) => ({
  additional_product_group: ownGroup(organizationId),
});

/** Translation ids sent for update must belong to the entity being updated. */
export function assertOwnTranslations(existing: { id: string }[], sent?: { id: string }[]) {
  const own = new Set(existing.map((t) => t.id));
  for (const t of sent ?? []) {
    if (!own.has(t.id)) throw new NotFoundException('Translation not found');
  }
}
