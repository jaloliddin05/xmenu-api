import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { additional_product_group_type } from "@prisma/client";

// 1️⃣ Additional Product Translation DTO
export class CreateAdditionalProductTranslationDto {
  @ApiProperty({ example: "en" })
  @IsString()
  readonly lang: string;

  @ApiProperty({ example: "Ketchup" })
  @IsString()
  readonly title: string;
}

// 2️⃣ Additional Product DTO
export class CreateAdditionalProductDto {
  @ApiProperty({ example: 5000 })
  @IsNumber()
  readonly price: number;

  @ApiProperty({ type: [CreateAdditionalProductTranslationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAdditionalProductTranslationDto)
  readonly translations: CreateAdditionalProductTranslationDto[];
}

// 3️⃣ Additional Product Group Translation DTO
export class CreateAdditionalProductGroupTranslationDto {
  @ApiProperty({ example: "en" })
  @IsString()
  readonly lang: string;

  @ApiProperty({ example: "Sauce type" })
  @IsString()
  readonly title: string;
}

// 4️⃣ Additional Product Group DTO
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

  @ApiProperty({ type: [CreateAdditionalProductDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAdditionalProductDto)
  readonly additional_products: CreateAdditionalProductDto[];
}
