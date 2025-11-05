import { Injectable } from '@nestjs/common';
import { OrganizationType } from '@prisma/client';


import { PrismaService } from '../../_prisma/prisma.service';
import { CreateOrganizationDto } from '../dto';
import { FileService } from 'src/modules/file/file.service';
import UpdateOrganizationDto from '../dto/update-organization.dto';
import { parseOrganizationType } from '../models/organization.model';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly fileService: FileService
  ) { }

  async create(data: CreateOrganizationDto, owner_id: string) {
    const organization = await this.prismaService.organization.findUnique({
      where: { owner_id },
    });

    // type ni enum ga moslashtiramiz
    const type = parseOrganizationType(data.type);

    // slug yaratamiz
    const slug = await this.generateUniqueSlug(data.name);

    if (organization) {
      // agar organization bor bo‘lsa, update qilamiz
      const updatedOrganization = await this.prismaService.organization.update({
        where: { id: organization.id },
        data: {
          ...data,
          slug,
          type,
        },
      });
      return updatedOrganization;
    }

    // yangi organization yaratish
    return await this.prismaService.organization.create({
      data: {
        ...data,
        slug,
        type,
        owner_id,
      },
    });
  }

  async findAll() {
    return await this.prismaService.organization.findMany()
  }

  async findOne(id: string) {
    return await this.prismaService.organization.findUnique({ where: { id } })
  }

  async findBySlug(slug: string) {
    return await this.prismaService.organization.findUnique({ 
      where: { slug },
      include:{
        logo: true,
        banner: true,
        translations: true,
        categories: {
          include: {
            translations: true,
            products: {
              include: {
                translations: true,
                additional_product_groups: {
                  include: {
                    translations: true,
                    additional_products: {
                      include: {
                        translations: true
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } 
    })
  }

  async findById(id: string) {
    const organization = await this.prismaService.organization.findUnique({
      where: { id }, include: {
        logo: true,
        banner: true
      }
    })
    return organization
  }

  async update(
    id: string,
    data: UpdateOrganizationDto,
    logo?: Express.Multer.File,
    banner?: Express.Multer.File,
  ) {
    const files: any = {};

    // 1️⃣ logo va banner
    if (logo) {
      const newLogo = await this.updateImage(logo, id, 'logo');
      files.logo_id = newLogo.id;
    }

    if (banner) {
      const newBanner = await this.updateImage(banner, id, 'banner');
      files.banner_id = newBanner.id;
    }

    // 2️⃣ mavjud organization ni topamiz
    const existing = await this.prismaService.organization.findUnique({
      where: { id },
    });
    if (!existing) throw new Error('Organization not found');

    // 3️⃣ type ni moslashtirish
    if (data.type) {
      data.type = parseOrganizationType(data.type);
    }

    // 4️⃣ agar name o‘zgargan bo‘lsa, slug qayta generatsiya qilamiz
    let slug = existing.slug;
    if (data.name && data.name !== existing.name) {
      slug = await this.generateUniqueSlug(data.name, id);
    }

    // 5️⃣ yangilash
    return await this.prismaService.organization.update({
      where: { id },
      data: {
        ...data,
        slug,
        ...files,
      },
      include: { logo: true, banner: true },
    });
  }

  async updateIsActive(owner_id: string, isActive: boolean) {
    return await this.prismaService.organization.update({ where: { owner_id }, data: { isActive } })
  }

  async delete(id: string) {
    return await this.prismaService.organization.delete({ where: { id } })
  }

  async updateImage(file: Express.Multer.File, id: string, type: 'logo' | 'banner') {
    const data = await this.findById(id);
    const avatar = await this.fileService.updateFile(data?.[type]?.id || '', file);
    return avatar;
  }

  async deleteImage(id: string, type) {
    const data = await this.findById(id);
    if (data?.[type]?.url) {
      await this.fileService.removeFile(data?.[type].id);
    }
  }

  slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // maxsus belgilarni olib tashlaydi
      .replace(/\s+/g, '-') // bo‘sh joylarni '-' bilan almashtiradi
      .replace(/--+/g, '-'); // ketma-ket – larni bitta qiladi
  }

  async isSlugExists(
    slug: string,
    excludeId?: string, // update paytida o‘zini hisobga olmaslik uchun
  ): Promise<boolean> {
    const existing = await this.prismaService.organization.findFirst({
      where: {
        slug,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    return !!existing;
  }

  async generateUniqueSlug(
    name: string,
    excludeId?: string,
  ): Promise<string> {
    const baseSlug = this.slugify(name);
    let slug = baseSlug;
    let counter = 1;

    while (await this.isSlugExists(slug, excludeId)) {
      slug = `${baseSlug}-${++counter}`;
    }

    return slug;
  }
}
