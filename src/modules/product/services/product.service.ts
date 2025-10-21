import { Injectable } from '@nestjs/common';


import { PrismaService } from '../../_prisma/prisma.service';
import { FileService } from 'src/modules/file/file.service';
import { CreateProductDto } from '../dto/create-product.dto';
import MoveProductDto from '../dto/move-product.dto';

@Injectable()
export class ProductService {
    constructor(
        private readonly prismaService: PrismaService,
        private readonly fileService: FileService
    ) { }

    async findAll(category_id: string, lang: string) {
        const where:any = {}
        category_id ? where['category_id'] = category_id : null;
        
        const products = await this.prismaService.product.findMany({
            where,
            include: {
                translations: {
                    where: { lang },
                    select: { title: true }
                },
                category: {
                    select: {
                        id: true,
                        translations: {
                            where: { lang },
                            select: { title: true }
                        }
                    }
                },
                images: true,
            },
        });

        // Formatlash
        return products.map(p => ({
            id: p.id,
            index: p.index,
            isActive: p.isActive,
            price: p.price,
            product_title: p.translations[0]?.title || null,
            category_id: p.category.id,
            category_title: p.category.translations[0]?.title || null,
            images: p.images.map(img => img.url) // agar image modelida `url` maydoni bo‘lsa
        }));
    }


    async findById(id: string) { }

    async createProduct(dto: CreateProductDto) {
        return await this.prismaService.$transaction(async (prisma) => {
            // 🧮 Oxirgi productni index bo‘yicha topamiz
            const lastProduct = await prisma.product.findFirst({
                where: { category_id: dto.category_id },
                orderBy: { index: 'desc' },
                select: { index: true },
            });

            const nextIndex = (lastProduct?.index || 0) + 1;

            // 🏗️ Product yaratish
            const newProduct = await prisma.product.create({
                data: {
                    price: dto.price,
                    weight: dto.weight,
                    protein: dto.protein,
                    kcal: dto.kcal,
                    fat: dto.fat,
                    carbohydrate: dto.carbohydrate,
                    unit: dto.unit,
                    index: nextIndex,

                    category: { connect: { id: dto.category_id } },

                    translations: {
                        create: dto.translations.map((t) => ({
                            lang: t.lang,
                            title: t.title,
                            description: t.description,
                        })),
                    },

                    // ➕ additional_product_groups ni yaratish
                    additional_product_groups: dto.additional_product_groups
                        ? {
                            create: dto.additional_product_groups.map((group) => ({
                                type: group.type,
                                is_required: group.is_required ?? false,
                                translations: {
                                    create: group.translations.map((t) => ({
                                        lang: t.lang,
                                        title: t.title,
                                    })),
                                },
                                additional_products: {
                                    create: group.additional_products.map((ap) => ({
                                        price: ap.price,
                                        translations: {
                                            create: ap.translations.map((t) => ({
                                                lang: t.lang,
                                                title: t.title,
                                            })),
                                        },
                                    })),
                                },
                            })),
                        }
                        : undefined,
                },
                include: {
                    translations: true,
                    category: true,
                    images: true,
                    additional_product_groups: {
                        include: {
                            translations: true,
                            additional_products: {
                                include: { translations: true },
                            },
                        },
                    },
                },
            });

            return newProduct;
        });
    }


    async update() {

    }

    async moveProduct(dto: MoveProductDto) {
    const { categoryId, productId, newIndex } = dto;

    // 1. Avval eski indexni topamiz
    const product = await this.prismaService.product.findUnique({
      where: { id: productId },
    });

    if (!product) throw new Error('Product not found');

    const oldIndex = product.index || 0;

    if (oldIndex === newIndex) return product; // hech narsa o‘zgarmaydi

    // 2. Agar pastdan yuqoriga ko‘tarilsa (masalan 10 → 3)
    if (oldIndex > newIndex) {
      await this.prismaService.product.updateMany({
        where: {
          category_id: categoryId,
          index: { gte: newIndex, lt: oldIndex },
        },
        data: { index: { increment: 1 } }, // o‘rtadagilarni 1 taga oshiramiz
      });
    }

    // 3. Agar yuqoridan pastga tushsa (masalan 3 → 10)
    else {
      await this.prismaService.product.updateMany({
        where: {
          category_id: categoryId,
          index: { gt: oldIndex, lte: newIndex },
        },
        data: { index: { decrement: 1 } }, // o‘rtadagilarni 1 taga kamaytiramiz
      });
    }

    // 4. O‘zi esa yangi indexga o‘tadi
    const updated = await this.prismaService.product.update({
      where: { id: productId },
      data: { index: newIndex },
    });

    return updated;
  }

    async updateIsActive(owner_id: string, isActive: boolean) {
        return await this.prismaService.organization.update({ where: { owner_id }, data: { isActive } })
    }

    async delete(id: string) {
        return await this.prismaService.organization.delete({ where: { id } })
    }

    // async handleUploadedImages(files?: Express.Multer.File[]): Promise<string[]> {
    //     const image_ids: string[] = [];
    //     if (files?.length) {
    //         for (const file of files) {
    //             const uploaded = await this.uploadImage(file);
    //             image_ids.push(uploaded.id);
    //         }
    //     }
    //     return image_ids;
    // }

    // async uploadImage(file: Express.Multer.File) {
    //     const image = await this.fileService.uploadFile(file);
    //     return image;
    // }

    // async updateImage(file: Express.Multer.File, id: string, type: 'logo' | 'banner') {
    //     const data = await this.findById(id);
    //     const avatar = await this.fileService.updateFile(data?.[type]?.id || '', file);
    //     return avatar;
    // }

    // async deleteImage(id: string, type) {
    //     const data = await this.findById(id);
    //     if (data?.[type]?.url) {
    //         await this.fileService.removeFile(data?.[type].id);
    //     }
    // }
}
