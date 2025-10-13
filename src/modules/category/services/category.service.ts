import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../_prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from '../dto';

@Injectable()
export class CategoryService {
  constructor(
    private readonly prismaService: PrismaService
  ) { }

  async createCategory(dto: CreateCategoryDto) {
    return await this.prismaService.category.create({
      data: {
        organization: {
          connect: { id: dto.organization_id }, // organization bilan bog‘lash
        },
        translations: {
          create: dto.translations.map(t => ({
            lang: t.lang,
            title: t.title,
          })),
        },
      },
      include: {
        translations: true,
        organization: true, // agar organization ma’lumotini qaytarmoqchi bo‘lsang
      },
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

  updateIsActive(id: string, isActive: boolean) {
    return this.prismaService.category.update({ where: { id }, data: { isActive } })
  }

  async delete(id: string) {
    return await this.prismaService.category.delete({ where: { id } })
  }
}
