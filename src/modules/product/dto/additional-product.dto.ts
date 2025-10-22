import { ApiProperty } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { additional_product_group_type } from "@prisma/client";

//
// 🔹 1. Additional product translation DTO
//
export class CreateAdditionalProductTranslationDto {
  @ApiProperty({ example: "en" })
  @IsString()
  readonly lang: string;

  @ApiProperty({ example: "Ketchup" })
  @IsString()
  readonly title: string;
}

//
// 🔹 2. Additional product create DTO
//
export class CreateAdditionalProductDto {
  @ApiProperty({ example: "uuid-of-group" })
  @IsString()
  readonly additional_product_group_id: string;

  @ApiProperty({ example: 5000 })
  @IsNumber()
  readonly price: number;

  @ApiProperty({ type: [CreateAdditionalProductTranslationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAdditionalProductTranslationDto)
  readonly translations: CreateAdditionalProductTranslationDto[];
}

//
// 🔹 3. Additional product group translation DTO
//
export class CreateAdditionalProductGroupTranslationDto {
  @ApiProperty({ example: "en" })
  @IsString()
  readonly lang: string;

  @ApiProperty({ example: "Sauce type" })
  @IsString()
  readonly title: string;
}

//
// 🔹 4. Additional product group create DTO
//
export class CreateAdditionalProductGroupDto {
  @ApiProperty({ example: "checkbox", enum: additional_product_group_type })
  @IsEnum(additional_product_group_type)
  readonly type: additional_product_group_type;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  readonly is_required?: boolean;

  @ApiProperty({ type: [CreateAdditionalProductGroupTranslationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAdditionalProductGroupTranslationDto)
  readonly translations: CreateAdditionalProductGroupTranslationDto[];
}
