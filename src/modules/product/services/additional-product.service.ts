import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../_prisma/prisma.service';
import { CreateAdditionalProductDto, CreateAdditionalProductGroupDto } from '../dto/additional-product.dto';
import { UpdateAdditionalProductDto, UpdateAdditionalProductGroupDto } from '../dto/update-additional-product.dto';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';
import { assertOwnTranslations, ownGroup, ownOption, ownProduct } from './menu-ownership';

@Injectable()
export class AdditionalProductService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly revalidateService: RevalidateService
  ) { }

  // Every id from the URL or the body must belong to the caller's organization; anything else is 404.

  private async findOwnGroup(id: string, organizationId: string) {
    const group = await this.prismaService.additional_product_group.findFirst({
      where: { id, ...ownGroup(organizationId) },
      include: { translations: true, product: true },
    });
    if (!group) throw new NotFoundException('Additional product group not found');
    return group;
  }

  private async findOwnOption(id: string, organizationId: string) {
    const option = await this.prismaService.additional_product.findFirst({
      where: { id, ...ownOption(organizationId) },
      include: { translations: true, additional_product_group: { include: { product: true } } },
    });
    if (!option) throw new NotFoundException('Additional product not found');
    return option;
  }

  private async assertOwnProduct(id: string, organizationId: string) {
    const product = await this.prismaService.product.findFirst({
      where: { id, ...ownProduct(organizationId) },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');
  }

  async createGroup(dto: CreateAdditionalProductGroupDto, organizationId: string, slug: string) {
    if (dto.product_id) await this.assertOwnProduct(dto.product_id, organizationId);

    const data: any = {
      is_multiple: dto.is_multiple ?? false,
      is_required: dto.is_required ?? false,
      min_selected: dto.min_selected,
      max_selected: dto.max_selected,
      translations: {
        create: dto.translations.map((t) => ({
          lang: t.lang,
          title: t.title,
        })),
      },
      organization: { connect: { id: organizationId } },
    };

    // Agar product_id kelsa — shunda bog‘laymiz (aks holda guruh POST /product da ulanadi)
    if (dto.product_id) {
      data.product = {
        connect: { id: dto.product_id },
      };
    }

    const add_prod_group = await this.prismaService.additional_product_group.create({
      data,
      include: {
        translations: true,
      },
    });

    if(dto?.product_id){
      await this.revalidateService.addRevalidationJob({slug})
    }

    return add_prod_group
  }

  // 🔹 2. Additional Product yaratish
  async createAdditionalProduct(dto: CreateAdditionalProductDto, organizationId: string, slug: string) {
    await this.findOwnGroup(dto.additional_product_group_id, organizationId);

    const add_prod = await this.prismaService.additional_product.create({
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
          include: { translations: true, product: true },
        },
      },
    });

    if(add_prod?.additional_product_group?.product?.id){
      await this.revalidateService.addRevalidationJob({slug})
    }

    return add_prod
  }

  async updateGroup(id: string, dto: UpdateAdditionalProductGroupDto, organizationId: string, slug: string) {
    const group = await this.findOwnGroup(id, organizationId);
    assertOwnTranslations(group.translations, dto.translations);
    if (dto.product_id) await this.assertOwnProduct(dto.product_id, organizationId);

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
    const add_prod_group = await this.prismaService.additional_product_group.update({
      where: { id },
      data: {
        is_multiple: dto.is_multiple,
        is_required: dto.is_required,
        min_selected: dto.min_selected,
        max_selected: dto.max_selected,
        product: dto.product_id ? { connect: { id: dto.product_id } } : undefined,
      },
      include: {
        translations: true,
      },
    });

    if(group?.product?.id){
      await this.revalidateService.addRevalidationJob({slug})
    }

    return add_prod_group
  }

  // ✅ UPDATE ADDITIONAL PRODUCT
  async updateAdditionalProduct(id: string, dto: UpdateAdditionalProductDto, organizationId: string, slug: string) {
    const product = await this.findOwnOption(id, organizationId);
    assertOwnTranslations(product.translations, dto.translations);
    if (dto.additional_product_group_id) await this.findOwnGroup(dto.additional_product_group_id, organizationId);

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
    const add_prod = await this.prismaService.additional_product.update({
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

    if(product?.additional_product_group?.product?.id){
      await this.revalidateService.addRevalidationJob({slug})
    }

    return add_prod
  }

  async deleteGroup(id: string, organizationId: string, slug: string) {
    await this.findOwnGroup(id, organizationId);
    const add_prod_gr = await this.prismaService.additional_product_group.delete({ where: { id }, include: { product: true } })
    if(add_prod_gr?.product?.id){
      await this.revalidateService.addRevalidationJob({slug})
    }
    return add_prod_gr

  }

  async delete(id: string, organizationId: string, slug: string) {
    await this.findOwnOption(id, organizationId);
    const add_prod = await this.prismaService.additional_product.delete({ where: { id }, include: { additional_product_group: { include: { product: true } } } })
    if(add_prod?.additional_product_group?.product?.id){
      await this.revalidateService.addRevalidationJob({slug})
    }
    return add_prod
  }

}
