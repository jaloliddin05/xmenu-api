import { Injectable } from '@nestjs/common';
import { Lang } from 'src/infra/http/request-helpers';
import { PrismaService } from '../_prisma/prisma.service';
import { MenuCategoryRow, MenuView, toMenuView } from './menu.mapper';

/** is_active: Boolean? @default(true) — NULL ham "faol" hisoblanadi (eski yozuvlar). */
export const ACTIVE = { OR: [{ is_active: true }, { is_active: null }] };

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  async getMenu(organizationId: string, lang: Lang): Promise<MenuView> {
    const rows = await this.prisma.category.findMany({
      where: { organization_id: organizationId, ...ACTIVE },
      orderBy: [{ index: 'asc' }, { created_at: 'asc' }],
      include: {
        translations: true,
        products: {
          where: ACTIVE,
          orderBy: [{ index: 'asc' }, { created_at: 'asc' }],
          include: {
            translations: true,
            images: { orderBy: { created_at: 'asc' } },
            additional_product_groups: {
              orderBy: { created_at: 'asc' },
              include: {
                translations: true,
                additional_products: { orderBy: { created_at: 'asc' }, include: { translations: true } },
              },
            },
          },
        },
      },
    });
    return toMenuView(rows as MenuCategoryRow[], lang);
  }
}
