import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../_prisma/prisma.service';
import { CreateAdditionalProductDto, CreateAdditionalProductGroupDto } from '../dto/additional-product.dto';

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

    async deleteGroup(id: string) {
        return await this.prismaService.additional_product_group.delete({ where: { id } })
    }

    async delete(id: string) {
        return await this.prismaService.additional_product.delete({ where: { id } })
    }

}
