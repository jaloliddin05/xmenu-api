import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsEnum, IsNumber, IsOptional, IsString, ValidateNested, IsUUID } from "class-validator";
import { Type } from "class-transformer";
import { product_unit } from "@prisma/client";

export class UpdateProductTranslationDto {
  @ApiProperty({ example: "translation-uuid" })
  @IsUUID()
  readonly id: string; // mavjud translation ID

  @ApiProperty({ example: "en" })
  @IsString()
  readonly lang: string;

  @ApiProperty({ example: "Chicken salad" })
  @IsString()
  readonly title: string;

  @ApiProperty({ example: "Fresh and healthy", required: false })
  @IsOptional()
  @IsString()
  readonly description?: string;
}

export class UpdateProductDto {
  @ApiProperty({ example: 15000, required: false })
  @IsOptional()
  @IsNumber()
  readonly price?: number;

  @ApiProperty({ example: "gr", enum: product_unit, required: false })
  @IsOptional()
  @IsEnum(product_unit)
  readonly unit?: product_unit;

  @ApiProperty({ example: 250, required: false })
  @IsOptional()
  @IsNumber()
  readonly weight?: number;

  @ApiProperty({ example: 200, required: false })
  @IsOptional()
  @IsNumber()
  readonly kcal?: number;

  @ApiProperty({ example: 12, required: false })
  @IsOptional()
  @IsNumber()
  readonly protein?: number;

  @ApiProperty({ example: 8, required: false })
  @IsOptional()
  @IsNumber()
  readonly fat?: number;

  @ApiProperty({ example: 30, required: false })
  @IsOptional()
  @IsNumber()
  readonly carbohydrate?: number;

  @ApiProperty({ example: "category-uuid", required: false })
  @IsOptional()
  @IsString()
  readonly category_id?: string;

  @ApiProperty({
    example: [
      { id: "uuid1", lang: "en", title: "Chicken salad", description: "Fresh and healthy" },
      { id: "uuid2", lang: "uz", title: "Tovuq salati", description: "Yangi va foydali" },
      { id: "uuid3", lang: "ru", title: "Куриный салат", description: "Свежий и полезный" },
    ],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateProductTranslationDto)
  readonly translations?: UpdateProductTranslationDto[];
}
