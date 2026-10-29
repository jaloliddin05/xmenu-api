import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../_prisma/prisma.service';
import { CreateOrganizationDto } from '../dto';
import { FileService } from 'src/modules/file/file.service';
import UpdateOrganizationDto from '../dto/update-organization.dto';
import { parseOrganizationType } from '../models/organization.model';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';
import { TenantService } from 'src/modules/tenant/tenant.service';
import { assertOwnTranslations } from 'src/modules/product/services/menu-ownership';
import { randomSlug, SLUG_MAX, slugify } from '../domain/slug';
import { PLATFORM_ORDER_SETTINGS, PLATFORM_SETTINGS } from '../domain/platform-defaults';
import { PublicOrganization, toPublicOrganization } from '../domain/public-organization';
import { parseTenantId } from 'src/modules/tenant/tenant-key';

const slugTaken = () => new ConflictException({ message: 'Slug is already taken', code: 'slug_taken' });

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly fileService: FileService,
    private readonly revalidateService: RevalidateService,
    private readonly tenants: TenantService,
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
          // A row left by the old signup flow may predate the settings tables
          settings: {
            upsert: { create: { ...PLATFORM_SETTINGS }, update: {} },
          },
          order_settings: {
            upsert: { create: { ...PLATFORM_ORDER_SETTINGS }, update: {} },
          },
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
        // Settings rows always exist; readers never substitute missing values (platform-defaults.ts)
        settings: { create: { ...PLATFORM_SETTINGS } },
        order_settings: { create: { ...PLATFORM_ORDER_SETTINGS } },
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

  /** An owner may only act on their own organization; any other id looks like it does not exist. */
  assertOwn(id: string, organizationId: string) {
    if (id !== organizationId) throw new NotFoundException('Organization not found');
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

  /** Slug of an active venue by its id (QR redirect /organization/{id}); null for anything else. */
  async findActiveSlug(id: string): Promise<string | null> {
    const tenantId = parseTenantId(id);
    if (!tenantId) return null;
    const organization = await this.prismaService.organization.findFirst({
      where: { id: tenantId, is_active: true },
      select: { slug: true },
    });
    return organization?.slug ?? null;
  }

  /** Public QR menu of an active venue: only the fields in PublicOrganization. */
  async findBySlug(slug: string, lang): Promise<PublicOrganization> {
    const organization = await this.prismaService.organization.findFirst({
      where: { slug, is_active: true },
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

    return toPublicOrganization(organization);
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
    organizationId: string,
    data: UpdateOrganizationDto,
    logo?: Express.Multer.File,
    banner?: Express.Multer.File,
    slug?: string
  ) {
    // Ownership first: nothing (not even the logo/banner files) is touched for someone else's venue
    this.assertOwn(id, organizationId);
    if (data.translations?.length) {
      const own = await this.prismaService.organization_translation.findMany({
        where: { organization_id: id },
        select: { id: true },
      });
      assertOwnTranslations(own, data.translations);
    }

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
    if (!existing) throw new NotFoundException('Organization not found');

    // 3️⃣ type ni moslashtirish
    if (data.type) data.type = parseOrganizationType(data.type);

    if (data.slug !== undefined && data.slug !== existing.slug && (await this.isSlugExists(data.slug, id))) {
      throw slugTaken();
    }


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
    try {
      await this.prismaService.organization.update({
        where: { id },
        data: { ...data, ...files },
        include: { logo: true, banner: true },
      });
    } catch (e) {
      // Two owners claiming the same slug at once: the unique index decides
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw slugTaken();
      throw e;
    }
    // Name and slug feed the cached tenant (brand name in SMS, slug in /tenant/by-slug)
    this.tenants.invalidate(id);

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


  async delete(id: string, organizationId: string) {
    this.assertOwn(id, organizationId);
    const deleted = await this.prismaService.organization.delete({ where: { id } });
    this.tenants.invalidate(id);
    return deleted;
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
    // Room for a "-N" suffix within SLUG_MAX
    const baseSlug = slugify(name, SLUG_MAX - 4);
    let slug = baseSlug;
    let counter = 1;

    while (await this.isSlugExists(slug, excludeId, tx)) {
      slug = counter < 999 ? `${baseSlug}-${++counter}` : randomSlug();
    }

    return slug;
  }
}
