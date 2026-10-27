import { Injectable, NotFoundException } from '@nestjs/common';


import { PrismaService } from '../../_prisma/prisma.service';
import { FileService } from 'src/modules/file/file.service';
import { CreateProductDto } from '../dto/create-product.dto';
import MoveProductDto from '../dto/move-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';
import { assertOwnTranslations, ownCategory, ownGroup, ownProduct } from './menu-ownership';

@Injectable()
export class ProductService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly fileService: FileService,
    private readonly revalidateService: RevalidateService
  ) { }

  // Every id from the URL or the body must belong to the caller's organization; anything else is 404.

  private async findOwnProduct(id: string, organizationId: string) {
    const product = await this.prismaService.product.findFirst({
      where: { id, ...ownProduct(organizationId) },
      include: { translations: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private async assertOwnCategory(id: string, organizationId: string) {
    const category = await this.prismaService.category.findFirst({
      where: { id, ...ownCategory(organizationId) },
      select: { id: true },
    });
    if (!category) throw new NotFoundException('Category not found');
  }

  private async assertOwnGroups(ids: string[] | undefined, organizationId: string) {
    if (!ids?.length) return;
    const unique = [...new Set(ids)];
    const found = await this.prismaService.additional_product_group.findMany({
      where: { id: { in: unique }, ...ownGroup(organizationId) },
      select: { id: true },
    });
    if (found.length !== unique.length) throw new NotFoundException('Additional product group not found');
  }

  async findAll(organization_id: string, category_id: string, lang: string, isActive?, title?: string) {
    const where: any = {}
    category_id ? where['category_id'] = category_id : null;
    isActive ? (isActive == 'true' ? where['isActive'] = true : where['isActive'] = false) : null
    if (title) {
      where.translations = {
        some: {
          lang,
          title: {
            contains: title,
            mode: 'insensitive'
          }
        }
      }
    }
    // Always scoped: without an organization this used to list every venue's dishes
    where.category = ownCategory(organization_id)


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
      orderBy: [
        { index: 'asc' },
        { created_at: 'asc' }
      ]
    });

    // Formatlash
    return products.map(p => ({
      id: p.id,
      index: p.index,
      is_active: p.is_active,
      price: p.price,
      product_title: p.translations[0]?.title || null,
      category_id: p.category.id,
      category_title: p.category.translations[0]?.title || null,
      images: p.images.map(img => img.url) // agar image modelida `url` maydoni bo‘lsa
    }));
  }

  async findById(id: string, organizationId: string) {
    const product = await this.prismaService.product.findFirst({
      where: { id, ...ownProduct(organizationId) },
      include: {
        translations: true,
        category: true,
        images: true,
        additional_product_groups: {
          include: {
            translations: true,
            additional_products: {
              include: { translations: true }
            }
          }
        }
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async createProduct(dto: CreateProductDto, organizationId: string, slug: string) {
    await this.assertOwnCategory(dto.category_id, organizationId);
    await this.assertOwnGroups(dto.additional_product_group_ids, organizationId);

    const product = await this.prismaService.$transaction(async (prisma) => {
      const lastProduct = await prisma.product.findFirst({
        where: { category_id: dto.category_id },
        orderBy: { index: "desc" },
        select: { index: true },
      });

      const nextIndex = (lastProduct?.index || 0) + 1;

      return prisma.product.create({
        data: {
          price: dto.price,
          unit: dto.unit,
          weight: dto.weight,
          kcal: dto.kcal,
          protein: dto.protein,
          fat: dto.fat,
          carbohydrate: dto.carbohydrate,
          index: nextIndex,
          category: { connect: { id: dto.category_id } },
          translations: {
            create: dto.translations.map(t => ({
              lang: t.lang,
              title: t.title,
              description: t.description,
            })),
          },
          additional_product_groups: dto.additional_product_group_ids
            ? {
              connect: dto.additional_product_group_ids.map(id => ({ id })),
            }
            : undefined,
        },
        include: {
          translations: true,
          category: true,
          additional_product_groups: {
            include: {
              translations: true,
              additional_products: { include: { translations: true } },
            },
          },
        },
      });
    });

    await this.revalidateService.addRevalidationJob({slug})
    return product
  }

  async updateProduct(id: string, dto: UpdateProductDto, organizationId: string, slug: string) {
    const existingProduct = await this.findOwnProduct(id, organizationId);
    assertOwnTranslations(existingProduct.translations, dto.translations);
    if (dto.category_id) await this.assertOwnCategory(dto.category_id, organizationId);

    const product = await this.prismaService.$transaction(async (prisma) => {
      // Translationlar yangilanishi
      if (dto.translations && dto.translations.length > 0) {
        for (const t of dto.translations) {
          await prisma.product_translation.update({
            where: { id: t.id },
            data: {
              lang: t.lang,
              title: t.title,
              description: t.description,
            },
          });
        }
      }
      
      // Product asosiy ma’lumotlarini yangilash
      return await prisma.product.update({
        where: { id },
        data: {
          price: dto.price,
          unit: dto.unit,
          weight: dto.weight,
          kcal: dto.kcal,
          protein: dto.protein,
          fat: dto.fat,
          carbohydrate: dto.carbohydrate,
          category: dto.category_id ? { connect: { id: dto.category_id } } : undefined,
        },
        include: {
          translations: true,
          category: true,
          additional_product_groups: {
            include: {
              translations: true,
              additional_products: { include: { translations: true } },
            },
          },
        },
      });
      
    });
    
    await this.revalidateService.addRevalidationJob({slug})
    return product
  }


  async moveProduct(dto: MoveProductDto, organizationId: string, slug: string) {
    const { categoryId, productId, newIndex } = dto;

    // 1. Avval eski indexni topamiz
    const product = await this.findOwnProduct(productId, organizationId);
    // The reindex below runs over categoryId, so it must be the product's own category
    if (product.category_id !== categoryId) throw new NotFoundException('Category not found');

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

    await this.revalidateService.addRevalidationJob({slug})

    return updated;
  }

  async updateIsActive(id: string, is_active: boolean, organizationId: string, slug: string) {
    await this.findOwnProduct(id, organizationId);
    const product = await this.prismaService.product.update({ where: { id }, data: { is_active } })
    await this.revalidateService.addRevalidationJob({slug})
    return product;
  }

  async delete(id: string, organizationId: string, slug: string) {
    await this.findOwnProduct(id, organizationId);
    const product = await this.prismaService.product.delete({ where: { id } })
    await this.revalidateService.addRevalidationJob({slug})
    return product
  }

  async addProductImages(productId: string, images: Express.Multer.File[], organizationId: string) {
    // 🔸 1. Productni tekshirish
    await this.findOwnProduct(productId, organizationId);

    // 🔸 2. Har bir rasmni FileService orqali yuklab olish
    const uploadedFiles: any = [];
    for (const image of images) {
      const file = await this.uploadImage(image);
      uploadedFiles.push(file);
    }

    // 🔸 3. Yuklangan fayllarni product bilan bog‘lash
    await this.prismaService.product.update({
      where: { id: productId },
      data: {
        images: {
          connect: uploadedFiles.map((file) => ({ id: file.id })),
        },
      },
    });

    return {
      message: 'Images successfully uploaded and linked to product',
      images: uploadedFiles,
    };
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

  async uploadImage(file: Express.Multer.File) {
    const image = await this.fileService.uploadFile(file);
    return image;
  }

  // async updateImage(file: Express.Multer.File, id: string, type: 'logo' | 'banner') {
  //     const data = await this.findById(id);
  //     const avatar = await this.fileService.updateFile(data?.[type]?.id || '', file);
  //     return avatar;
  // }

  async deleteImage(id: string, organizationId: string) {
    // Only images attached to your own dish; logos, avatars and other venues' files are 404 here
    const image = await this.prismaService.file.findFirst({
      where: { id, product: ownProduct(organizationId) },
      select: { id: true },
    });
    if (!image) throw new NotFoundException('Image not found');
    await this.fileService.removeFile(id);
  }
}
