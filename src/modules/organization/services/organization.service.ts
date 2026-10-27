import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../_prisma/prisma.service';
import { CreateOrganizationDto } from '../dto';
import { FileService } from 'src/modules/file/file.service';
import UpdateOrganizationDto from '../dto/update-organization.dto';
import { parseOrganizationType } from '../models/organization.model';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly fileService: FileService,
    private readonly revalidateService: RevalidateService
  ) { }

  async create(data: CreateOrganizationDto, owner_id: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prismaService;
    const existingOrg = await db.organization.findUnique({
      where: { owner_id },
    });

    const type = parseOrganizationType(data.type);
    const slug = await this.generateUniqueSlug(data.name, existingOrg?.id, tx);

    // 🔁 agar organization allaqachon bor bo‘lsa — update qilamiz
    if (existingOrg) {
      const updatedOrg = await db.organization.update({
        where: { id: existingOrg.id },
        data: {
          ...data,
          slug,
          type,
        },
      });
      return updatedOrg;
    }

    // 🌍 organization yaratilganda 3 tilda translation create qilish
    const organization = await db.organization.create({
      data: {
        ...data,
        slug,
        type,
        owner_id,
        translations: {
          create: [
            {
              lang: 'uz',
              description: '',
            },
            {
              lang: 'en',
              description: '',
            },
            {
              lang: 'ru',
              description: '',
            },
          ],
        },
      },
      include: {
        translations: true,
      },
    });

    return organization;
  }

  async findAll() {
    return await this.prismaService.organization.findMany()
  }

  async findOne(id: string) {
    const isNumber = !isNaN(Number(id));
    let organization

    if (isNumber) {
      organization = await this.prismaService.organization.findUnique({
        where: { int_id: Number(id) },
      });
    } else {
      organization = await this.prismaService.organization.findUnique({
        where: { id },
      });
    }

    if (!organization) {
      throw new NotFoundException(`Organization not found`);
    }

    return organization;
  }

  async findBySlug(slug: string, lang) {
    const organization = await this.prismaService.organization.findUnique({
      where: { slug },
      include: {
        logo: true,
        banner: true,
        translations: {
          where: { lang },
          select: { id: true, lang: true, description: true },
        },

        // CATEGORY  
        categories: {
          where: { is_active: true },        // ← faqat active
          orderBy: { index: 'asc' },         // ← sort

          include: {
            translations: {
              where: { lang },
              select: { id: true, lang: true, title: true },
            },

            // PRODUCT
            products: {
              where: { is_active: true },    // ← faqat active product
              orderBy: { index: 'asc' },     // ← sort

              include: {
                images: true,

                translations: {
                  where: { lang },
                  select: {
                    id: true,
                    lang: true,
                    title: true,
                    description: true,
                  },
                },

                additional_product_groups: {
                  include: {
                    translations: {
                      where: { lang },
                      select: {
                        id: true,
                        lang: true,
                        title: true,
                      },
                    },

                    additional_products: {
                      include: {
                        translations: {
                          where: { lang },
                          select: {
                            id: true,
                            lang: true,
                            title: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException(`Organization with slug "${slug}" not found`);
    }

    return organization;
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
    slug?: string
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
    const existing = await this.prismaService.organization.findUnique({ where: { id } });
    if (!existing) throw new Error('Organization not found');

    // 3️⃣ type ni moslashtirish
    if (data.type) data.type = parseOrganizationType(data.type);


    // 6️⃣ translations ni yangilash
    if (data.translations?.length) {
      for (const t of data.translations) {
        await this.prismaService.organization_translation.update({
          where: { id: t.id },
          data: {
            lang: t.lang,
            description: t.description,
          },
        });
      }
    }

    delete data.translations;

        // 5️⃣ asosiy organization yangilash
    const updatedOrg = await this.prismaService.organization.update({
      where: { id },
      data: { ...data, ...files },
      include: { logo: true, banner: true },
    });

    if (data?.slug) {
      await this.revalidateService.addRevalidationJob({id, newSlug:data?.slug, oldSlug: existing?.slug, route: 'organization'})
    } else {
      await this.revalidateService.addRevalidationJob({slug})
    }

    // 7️⃣ yangilangan ma’lumotni qaytarish
    return await this.prismaService.organization.findUnique({
      where: { id },
      include: {
        logo: true,
        banner: true,
        translations: true,
      },
    });
  }


  async updateIsActive(owner_id: string, is_active: boolean) {
    const organization = await this.prismaService.organization.update({ where: { owner_id }, data: { is_active } })
    await this.revalidateService.addRevalidationJob({slug:organization.slug})
    return organization
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
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const existing = await (tx ?? this.prismaService).organization.findFirst({
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
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const baseSlug = this.slugify(name);
    let slug = baseSlug;
    let counter = 1;

    while (await this.isSlugExists(slug, excludeId, tx)) {
      slug = `${baseSlug}-${++counter}`;
    }

    return slug;
  }
}
