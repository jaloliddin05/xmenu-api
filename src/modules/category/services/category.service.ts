import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../_prisma/prisma.service';
import { CreateCategoryDto, MoveCategoryDto, UpdateCategoryDto } from '../dto';

@Injectable()
export class CategoryService {
  constructor(
    private readonly prismaService: PrismaService
  ) { }

  async createCategory(dto: CreateCategoryDto) {
    return await this.prismaService.$transaction(async (prisma) => {

      const lastCategory = await prisma.category.findFirst({
        where: { organization_id: dto.organization_id },
        orderBy: { index: 'desc' },
        select: { index: true },
      });

      const nextIndex = (lastCategory?.index || 0) + 1;

      const newCategory = await prisma.category.create({
        data: {
          organization: {
            connect: { id: dto.organization_id },
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
  }

  async findAll(lang: string) {
    const categories = await this.prismaService.category.findMany({
      where: {},
      include: {
        translations: {
          where: { lang }, // faqat berilgan til bo‘yicha translation
          select: { id: true, lang: true, title: true }
        }
      },
    })

    return categories.map(c => ({
      id: c.id,
      isActive: c.isActive,
      index: c.index,
      translation: c.translations[0] || null
    }));
  }

  async findOne(id: string) {
    return await this.prismaService.category.findUnique({ where: { id }, include: { translations: true } });
  }

  async update(id: string, data: UpdateCategoryDto) {
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

    return this.prismaService.category.findUnique({
      where: { id },
      include: { translations: true },
    });
  }

  async moveCategory(dto: MoveCategoryDto) {
    const { categoryId, organizationId, newIndex } = dto;

    // 1. Avval eski indexni topamiz
    const category = await this.prismaService.category.findUnique({
      where: { id: categoryId },
    });

    if (!category) throw new Error('Category not found');

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

    return updated;
  }

  updateIsActive(id: string, isActive: boolean) {
    return this.prismaService.category.update({ where: { id }, data: { isActive } })
  }

  async delete(id: string) {
    return await this.prismaService.category.delete({ where: { id } })
  }
}
