import { Injectable } from '@nestjs/common';
import { PrismaService } from '../_prisma/prisma.service';
import { hiddenByStopList } from '../pos/domain/stop-list';
import {
  MenuCategoryRow,
  MenuLocale,
  MenuView,
  toMenuView,
} from './menu.mapper';

/** is_active: Boolean? @default(true) — NULL ham "faol" hisoblanadi (eski yozuvlar). */
export const ACTIVE = { OR: [{ is_active: true }, { is_active: null }] };

/** Not hidden by the POS: rows without a POS link, or linked to a position that is still offered there. */
export const SHOWN_BY_POS = {
  OR: [{ pos_link: null }, { pos_link: { hidden_in_pos: false } }],
};

/**
 * Dishes the POS stop list takes out of the menu: stopped in every branch linked to the POS, or in
 * `branchId` when given (docs/API.md, "Интеграция с кассой (iiko)").
 */
export async function stoppedProductIds(
  prisma: PrismaService,
  organizationId: string,
  branchId?: string,
): Promise<string[]> {
  const pos = await prisma.pos_integration.findUnique({
    where: { organization_id: organizationId },
    select: {
      status: true,
      branch_links: { select: { branch_id: true } },
      stop_items: { select: { product_id: true, branch_id: true } },
    },
  });
  if (!pos || pos.status === 'draft') return [];
  return [
    ...hiddenByStopList(
      pos.stop_items,
      pos.branch_links.map((b) => b.branch_id),
      branchId,
    ),
  ];
}

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  async getMenu(
    organizationId: string,
    locale: MenuLocale,
    branchId?: string,
  ): Promise<MenuView> {
    const stopped = await stoppedProductIds(
      this.prisma,
      organizationId,
      branchId,
    );
    const rows = await this.prisma.category.findMany({
      where: { organization_id: organizationId, AND: [ACTIVE, SHOWN_BY_POS] },
      orderBy: [{ index: 'asc' }, { created_at: 'asc' }],
      include: {
        translations: true,
        products: {
          where: {
            AND: [ACTIVE, SHOWN_BY_POS],
            ...(stopped.length ? { id: { notIn: stopped } } : {}),
          },
          orderBy: [{ index: 'asc' }, { created_at: 'asc' }],
          include: {
            translations: true,
            images: { orderBy: { created_at: 'asc' } },
            additional_product_groups: {
              orderBy: { created_at: 'asc' },
              include: {
                translations: true,
                additional_products: {
                  orderBy: { created_at: 'asc' },
                  include: { translations: true },
                },
              },
            },
          },
        },
      },
    });
    return toMenuView(rows as MenuCategoryRow[], locale);
  }
}
