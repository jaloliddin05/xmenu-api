import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsEnum, IsNumber, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { product_unit } from "@prisma/client";

export class CreateProductTranslationDto {
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

export class CreateProductDto {
  @ApiProperty({ example: 15000 })
  @IsNumber()
  readonly price: number;

  @ApiProperty({ example: "gr", enum: product_unit })
  @IsEnum(product_unit)
  readonly unit: product_unit;

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

  @ApiProperty({ example: "category-uuid" })
  @IsString()
  readonly category_id: string;

  @ApiProperty({
    example: [
      { lang: "en", title: "Chicken salad", description: "Fresh and healthy" },
      { lang: "uz", title: "Tovuq salati", description: "Yangi va foydali" }
    ]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductTranslationDto)
  readonly translations: CreateProductTranslationDto[];

  @ApiProperty({ example: ["uuid-group-1", "uuid-group-2"], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly additional_product_group_ids?: string[];
}
