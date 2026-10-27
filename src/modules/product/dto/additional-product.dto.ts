import { ApiProperty } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  Min,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

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
  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  readonly is_multiple: boolean;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  readonly is_required?: boolean;

  @ApiProperty({ example: 2, required: false, description: "Kamida nechta variant tanlanishi kerak (bo'sh — is_required bo'yicha)" })
  @IsOptional()
  @IsInt()
  @Min(0)
  readonly min_selected?: number;

  @ApiProperty({ example: 4, required: false, description: "Ko'pi bilan nechta variant (bo'sh — is_multiple bo'yicha)" })
  @IsOptional()
  @IsInt()
  @Min(1)
  readonly max_selected?: number;

  @ApiProperty({
    example: 'uuid',
    required: false,
    description: 'Your own dish; omit when the dish does not exist yet and pass the group id in POST /product',
  })
  @IsOptional()
  @IsString()
  readonly product_id?: string;

  @ApiProperty({ type: [CreateAdditionalProductGroupTranslationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAdditionalProductGroupTranslationDto)
  readonly translations: CreateAdditionalProductGroupTranslationDto[];
}
