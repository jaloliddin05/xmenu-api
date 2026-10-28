import { ApiProperty } from "@nestjs/swagger";
import { Type, Transform, plainToInstance } from "class-transformer";
import {
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  ValidateBy,
  ValidateNested,
} from "class-validator";
import { isValidSlug, SLUG_RULE } from "../domain/slug";

class UpdateOrganizationTranslationDto {
  @ApiProperty({ example: "translation-uuid" })
  @IsUUID()
  readonly id: string;

  @ApiProperty({ example: "en" })
  @IsString()
  readonly lang: string;

  @ApiProperty({ example: "Fresh and healthy", required: false })
  @IsOptional()
  @IsString()
  readonly description?: string;
}

class UpdateOrganizationDto {
  @ApiProperty({ description: `type`, required: false })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty({ description: `name`, required: false })
  @IsOptional()
  @IsString()
  readonly name?: string;

  @ApiProperty({ description: `Public slug: ${SLUG_RULE}. Taken by another venue: 409 slug_taken`, example: "cafe-example", required: false })
  @IsOptional()
  @ValidateBy({ name: "isSlug", validator: { validate: isValidSlug, defaultMessage: () => `slug: ${SLUG_RULE}` } })
  readonly slug?: string;

  @ApiProperty({
    description: `logo`,
    type: "string",
    format: "binary",
    required: false,
  })
  @IsOptional()
  logo?: any;

  @ApiProperty({
    description: `banner`,
    type: "string",
    format: "binary",
    required: false,
  })
  @IsOptional()
  banner?: any;

  @ApiProperty({
    example: [
      { id: "uuid1", lang: "en", description: "Fresh and healthy" },
      { id: "uuid2", lang: "uz", description: "Yangi va foydali" },
      { id: "uuid3", lang: "ru", description: "Свежий и полезный" },
    ],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Transform(({ value }) => {
    // ⚙️ 1️⃣ Agar form-data dan string kelsa → JSON.parse
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        // ⚙️ 2️⃣ parsed ni class-transformer instance ga aylantiramiz
        return plainToInstance(UpdateOrganizationTranslationDto, parsed);
      } catch (error) {
        console.error("❌ Invalid JSON in translations:", value);
        return [];
      }
    }

    // ⚙️ 3️⃣ Agar allaqachon array kelsa → to‘g‘ridan-to‘g‘ri qaytaramiz
    if (Array.isArray(value)) {
      return plainToInstance(UpdateOrganizationTranslationDto, value);
    }

    return [];
  })
  @Type(() => UpdateOrganizationTranslationDto)
  translations?: UpdateOrganizationTranslationDto[];
}

export default UpdateOrganizationDto;
