import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../_prisma/prisma.service';
import { CreateAdditionalProductDto, CreateAdditionalProductGroupDto } from '../dto/additional-product.dto';
import { UpdateAdditionalProductDto, UpdateAdditionalProductGroupDto } from '../dto/update-additional-product.dto';

@Injectable()
export class AdditionalProductService {
    constructor(
        private readonly prismaService: PrismaService,
    ) { }

    async createGroup(dto: CreateAdditionalProductGroupDto) {
        const data: any = {
            is_multiple: dto.is_multiple ?? false,
            is_required: dto.is_required ?? false,
            translations: {
                create: dto.translations.map((t) => ({
                    lang: t.lang,
                    title: t.title,
                })),
            },
        };

        // Agar product_id kelsa — shunda bog‘laymiz
        if (dto.product_id) {
            data.product = {
                connect: { id: dto.product_id },
            };
        }

        return this.prismaService.additional_product_group.create({
            data,
            include: {
                translations: true,
            },
        });
    }

    // 🔹 2. Additional Product yaratish
    async createAdditionalProduct(dto: CreateAdditionalProductDto) {
        return this.prismaService.additional_product.create({
            data: {
                price: dto.price,
                additional_product_group: {
                    connect: { id: dto.additional_product_group_id },
                },
                translations: {
                    create: dto.translations.map((t) => ({
                        lang: t.lang,
                        title: t.title,
                    })),
                },
            },
            include: {
                translations: true,
                additional_product_group: {
                    include: { translations: true },
                },
            },
        });
    }

    async updateGroup(id: string, dto: UpdateAdditionalProductGroupDto) {
    const group = await this.prismaService.additional_product_group.findUnique({
      where: { id },
      include: { translations: true },
    });

    if (!group) throw new NotFoundException("Additional product group not found");

    // 🔹 Translationlarni update qilish
    if (dto.translations && dto.translations.length > 0) {
      for (const t of dto.translations) {
        await this.prismaService.additional_product_group_translation.update({
          where: { id: t.id },
          data: {
            lang: t.lang,
            title: t.title,
          },
        });
      }
    }

    // 🔹 Asosiy group ma’lumotlarini yangilash
    return this.prismaService.additional_product_group.update({
      where: { id },
      data: {
        is_multiple: dto.is_multiple,
        is_required: dto.is_required,
        product: dto.product_id ? { connect: { id: dto.product_id } } : undefined,
      },
      include: {
        translations: true,
      },
    });
  }

  // ✅ UPDATE ADDITIONAL PRODUCT
  async updateAdditionalProduct(id: string, dto: UpdateAdditionalProductDto) {
    const product = await this.prismaService.additional_product.findUnique({
      where: { id },
      include: { translations: true },
    });

    if (!product) throw new NotFoundException("Additional product not found");

    // 🔹 Translationlarni update qilish
    if (dto.translations && dto.translations.length > 0) {
      for (const t of dto.translations) {
        await this.prismaService.additional_product_translation.update({
          where: { id: t.id },
          data: {
            lang: t.lang,
            title: t.title,
          },
        });
      }
    }

    // 🔹 Asosiy product ma’lumotlarini yangilash
    return this.prismaService.additional_product.update({
      where: { id },
      data: {
        price: dto.price,
        additional_product_group: dto.additional_product_group_id
          ? { connect: { id: dto.additional_product_group_id } }
          : undefined,
      },
      include: {
        translations: true,
        additional_product_group: {
          include: { translations: true },
        },
      },
    });
  }

    async deleteGroup(id: string) {
        return await this.prismaService.additional_product_group.delete({ where: { id } })
    }

    async delete(id: string) {
        return await this.prismaService.additional_product.delete({ where: { id } })
    }

}
