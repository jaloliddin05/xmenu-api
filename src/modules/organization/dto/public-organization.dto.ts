import { ApiProperty } from '@nestjs/swagger';
import type {
  PublicCategory,
  PublicFile,
  PublicModifier,
  PublicModifierGroup,
  PublicOrganization,
  PublicProduct,
} from '../domain/public-organization';

class PublicFileDto implements PublicFile {
  @ApiProperty() id: string;
  @ApiProperty() url: string;
}

class TitleTranslationDto {
  @ApiProperty({ example: 'ru' }) lang: string;
  @ApiProperty() title: string;
}

class DescriptionTranslationDto {
  @ApiProperty({ example: 'ru' }) lang: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
}

class ProductTranslationDto {
  @ApiProperty({ example: 'ru' }) lang: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
}

class PublicModifierDto implements PublicModifier {
  @ApiProperty() id: string;
  @ApiProperty() price: number;
  @ApiProperty({ type: [TitleTranslationDto] })
  translations: TitleTranslationDto[];
}

class PublicModifierGroupDto implements PublicModifierGroup {
  @ApiProperty() id: string;
  @ApiProperty() is_required: boolean;
  @ApiProperty() is_multiple: boolean;
  @ApiProperty({ type: Number, nullable: true }) min_selected: number | null;
  @ApiProperty({ type: Number, nullable: true }) max_selected: number | null;
  @ApiProperty({ type: [TitleTranslationDto] })
  translations: TitleTranslationDto[];
  @ApiProperty({ type: [PublicModifierDto] })
  additional_products: PublicModifierDto[];
}

class PublicProductDto implements PublicProduct {
  @ApiProperty() id: string;
  @ApiProperty() price: number;
  @ApiProperty({ type: Number, nullable: true }) weight: number | null;
  @ApiProperty({ type: Number, nullable: true }) protein: number | null;
  @ApiProperty({ type: Number, nullable: true }) kcal: number | null;
  @ApiProperty({ type: Number, nullable: true }) fat: number | null;
  @ApiProperty({ type: Number, nullable: true }) carbohydrate: number | null;
  @ApiProperty({ enum: ['gr', 'ml'] }) unit: string;
  @ApiProperty({ type: [PublicFileDto] }) images: PublicFileDto[];
  @ApiProperty({ type: [ProductTranslationDto] })
  translations: ProductTranslationDto[];
  @ApiProperty({ type: [PublicModifierGroupDto] })
  additional_product_groups: PublicModifierGroupDto[];
}

class PublicCategoryDto implements PublicCategory {
  @ApiProperty() id: string;
  @ApiProperty({ type: [TitleTranslationDto] })
  translations: TitleTranslationDto[];
  @ApiProperty({ type: [PublicProductDto] }) products: PublicProductDto[];
}

/** GET /organization/slug/:slug (QR menu). Translations are filtered by `?lang=`. */
export class PublicOrganizationDto implements PublicOrganization {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) slug: string | null;
  @ApiProperty({ example: 'restaurant' }) type: string;
  @ApiProperty({ type: PublicFileDto, nullable: true })
  logo: PublicFileDto | null;
  @ApiProperty({ type: PublicFileDto, nullable: true })
  banner: PublicFileDto | null;
  @ApiProperty({ type: [DescriptionTranslationDto] })
  translations: DescriptionTranslationDto[];
  @ApiProperty({ type: [PublicCategoryDto] }) categories: PublicCategoryDto[];
}
