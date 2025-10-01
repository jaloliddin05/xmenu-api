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
    return await this.prismaService.category.findUnique({ where: { id } })
  }

  async update(id: string, data: UpdateCategoryDto) {
    return await this.prismaService.category.update({ data, where: { id } })
  }

  async delete(id: string) {
    return await this.prismaService.category.delete({ where: { id } })
  }
}
