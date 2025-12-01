import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../_prisma/prisma.service';
import { CreateCategoryDto, MoveCategoryDto, UpdateCategoryDto } from '../dto';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';

@Injectable()
export class CategoryService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly revalidateService: RevalidateService
  ) { }

  async createCategory(dto: CreateCategoryDto, slug:string) {
    const category = await this.prismaService.$transaction(async (prisma) => {

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

    await this.revalidateService.addRevalidationJob({slug})

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

  async getForSelect(organizationId: string, lang:string) {
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

  async findOne(id: string) {
    return await this.prismaService.category.findUnique({ where: { id }, include: { translations: true } });
  }

  async update(id: string, data: UpdateCategoryDto,slug:string) {
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

    await this.revalidateService.addRevalidationJob({slug})

    return this.prismaService.category.findUnique({
      where: { id },
      include: { translations: true },
    });
  }

  async moveCategory(dto: MoveCategoryDto, slug:string) {
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

    await this.revalidateService.addRevalidationJob({slug})

    return updated;
  }

  async updateIsActive(id: string, is_active: boolean,slug:string) {
    const category = await this.prismaService.category.update({ where: { id }, data: { is_active } })
    await this.revalidateService.addRevalidationJob({slug})
    return category
  }

  async delete(id: string, slug:string) {
    const category =  await this.prismaService.category.delete({ where: { id } })
    await this.revalidateService.addRevalidationJob({slug})
    return category
  }
}
