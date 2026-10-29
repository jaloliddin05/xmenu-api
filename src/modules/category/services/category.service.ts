import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../_prisma/prisma.service';
import { CreateCategoryDto, MoveCategoryDto, UpdateCategoryDto } from '../dto';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';
import { ownCategory } from 'src/modules/product/services/menu-ownership';

@Injectable()
export class CategoryService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly revalidateService: RevalidateService
  ) { }

  // Every id from the URL or the body must belong to the caller's organization; anything else is 404.

  private async findOwnCategory(id: string, organizationId: string) {
    const category = await this.prismaService.category.findFirst({
      where: { id, ...ownCategory(organizationId) },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  /** Legacy body/URL field: tolerated only when it names the caller's own organization. */
  private assertSameOrganization(sent: string | undefined, organizationId: string) {
    if (sent !== undefined && sent !== organizationId) throw new NotFoundException('Organization not found');
  }

  async createCategory(dto: CreateCategoryDto, organizationId: string, slug:string) {
    this.assertSameOrganization(dto.organization_id, organizationId);

    const category = await this.prismaService.$transaction(async (prisma) => {

      const lastCategory = await prisma.category.findFirst({
        where: { organization_id: organizationId },
        orderBy: { index: 'desc' },
        select: { index: true },
      });

      const nextIndex = (lastCategory?.index || 0) + 1;

      const newCategory = await prisma.category.create({
        data: {
          organization: {
            connect: { id: organizationId },
          },
          index: nextIndex,
          translations: {
            create: dto.translations.map((t) => ({
              lang: t.lang,
              title: t.title,
            })),
          },
        },
        include: {
          translations: true,
          organization: true,
        },
      });

      return newCategory;
    });

    await this.revalidateService.addRevalidationJob({ tenantId: organizationId, route: 'menu', slug })

    return category;
  }

  async findAll(lang: string,organizationId: string) {
    const categories = await this.prismaService.category.findMany({
      where: {
        organization_id: organizationId
      },
      include: {
        translations: {
          where: { lang }, // faqat berilgan til bo‘yicha translation
          select: { id: true, lang: true, title: true }
        }
      },
      orderBy: { index: 'asc' }
    })

    return categories.map(c => ({
      id: c.id,
      is_active: c.is_active,
      index: c.index,
      translation: c.translations[0] || null
    }));
  }

  async getForSelect(requestedOrganizationId: string, organizationId: string, lang:string) {
    this.assertSameOrganization(requestedOrganizationId, organizationId);
    const categories = await this.prismaService.category.findMany({
      where: { organization_id: organizationId, is_active: true },
      include: {
        translations: {
          where: { lang },
          select: { id: true, lang: true, title: true }
        }
      },
      orderBy: { index: 'asc' }
    });

    return categories.map(c => ({
      id: c.id,
      title: c.translations[0]?.title || 'No title',
    }));
  }

  async findOne(id: string, organizationId: string) {
    const category = await this.prismaService.category.findFirst({
      where: { id, ...ownCategory(organizationId) },
      include: { translations: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async update(id: string, data: UpdateCategoryDto, organizationId: string, slug:string) {
    await this.findOwnCategory(id, organizationId);
    const { translations } = data;

    if (!translations || translations.length === 0) {
      return await this.prismaService.category.findUnique({
        where: { id },
        include: { translations: true },
      });
    }

    // Promise.all bilan parallel ishlov berish
    await Promise.all(
      translations.map(async tr => {
        const existing = await this.prismaService.category_translation.findFirst({
          where: {
            category_id: id,
            lang: tr.lang,
          },
        });

        if (existing) {
          await this.prismaService.category_translation.update({
            where: { id: existing.id },
            data: { title: tr.title },
          });
        } else {
          await this.prismaService.category_translation.create({
            data: {
              category_id: id,
              lang: tr.lang,
              title: tr.title,
            },
          });
        }
      })
    );

    await this.revalidateService.addRevalidationJob({ tenantId: organizationId, route: 'menu', slug })

    return this.prismaService.category.findUnique({
      where: { id },
      include: { translations: true },
    });
  }

  async moveCategory(dto: MoveCategoryDto, organizationId: string, slug:string) {
    const { categoryId, newIndex } = dto;
    // The reindex below runs over the whole organization, so it must be the caller's own
    this.assertSameOrganization(dto.organizationId, organizationId);

    // 1. Avval eski indexni topamiz
    const category = await this.findOwnCategory(categoryId, organizationId);

    const oldIndex = category.index || 0;

    if (oldIndex === newIndex) return category; // hech narsa o‘zgarmaydi

    // 2. Agar pastdan yuqoriga ko‘tarilsa (masalan 10 → 3)
    if (oldIndex > newIndex) {
      await this.prismaService.category.updateMany({
        where: {
          organization_id: organizationId,
          index: { gte: newIndex, lt: oldIndex },
        },
        data: { index: { increment: 1 } }, // o‘rtadagilarni 1 taga oshiramiz
      });
    }

    // 3. Agar yuqoridan pastga tushsa (masalan 3 → 10)
    else {
      await this.prismaService.category.updateMany({
        where: {
          organization_id: organizationId,
          index: { gt: oldIndex, lte: newIndex },
        },
        data: { index: { decrement: 1 } }, // o‘rtadagilarni 1 taga kamaytiramiz
      });
    }

    // 4. O‘zi esa yangi indexga o‘tadi
    const updated = await this.prismaService.category.update({
      where: { id: categoryId },
      data: { index: newIndex },
    });

    await this.revalidateService.addRevalidationJob({ tenantId: organizationId, route: 'menu', slug })

    return updated;
  }

  async updateIsActive(id: string, is_active: boolean, organizationId: string, slug:string) {
    await this.findOwnCategory(id, organizationId);
    const category = await this.prismaService.category.update({ where: { id }, data: { is_active } })
    await this.revalidateService.addRevalidationJob({ tenantId: organizationId, route: 'menu', slug })
    return category
  }

  async delete(id: string, organizationId: string, slug:string) {
    await this.findOwnCategory(id, organizationId);
    const category =  await this.prismaService.category.delete({ where: { id } })
    await this.revalidateService.addRevalidationJob({ tenantId: organizationId, route: 'menu', slug })
    return category
  }
}
