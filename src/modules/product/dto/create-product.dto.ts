import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsEnum, IsNumber, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { product_unit } from "@prisma/client";
import { CreateAdditionalProductGroupDto } from "./additional-product.dto";

export class CreateProductDto {
  @ApiProperty({ example: 15000 })
  @IsNumber()
  readonly price: number;

  @ApiProperty({ example: 250, required: false })
  @IsOptional()
  @IsNumber()
  readonly weight?: number;

  @ApiProperty({ example: 12, required: false })
  @IsOptional()
  @IsNumber()
  readonly protein?: number;

  @ApiProperty({ example: 200, required: false })
  @IsOptional()
  @IsNumber()
  readonly kcal?: number;

  @ApiProperty({ example: 8, required: false })
  @IsOptional()
  @IsNumber()
  readonly fat?: number;

  @ApiProperty({ example: 30, required: false })
  @IsOptional()
  @IsNumber()
  readonly carbohydrate?: number;

  @ApiProperty({ example: "gr", enum: product_unit })
  @IsEnum(product_unit)
  readonly unit: product_unit;

  @ApiProperty({
    example: [
      { lang: "en", title: "Chicken salad", description: "Fresh and healthy" },
      { lang: "ru", title: "Куриный салат", description: "Свежий и полезный" },
      { lang: "uz", title: "Tovuq salati", description: "Yangi va foydali" },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductTranslationDto)
  readonly translations: CreateProductTranslationDto[];

  @ApiProperty({ example: "category-id-uuid" })
  @IsString()
  readonly category_id: string;

  @ApiProperty({ type: [CreateAdditionalProductGroupDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAdditionalProductGroupDto)
  readonly additional_product_groups?: CreateAdditionalProductGroupDto[];
}


export class CreateProductTranslationDto {
  @IsString()
  readonly lang: string;

  @IsString()
  readonly title: string;

  @IsOptional()
  @IsString()
  readonly description?: string;
}

