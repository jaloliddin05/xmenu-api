import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { additional_product_group_type } from "@prisma/client";


// 1️⃣ Eng avval eng kichik DTO'lar
export class CreateAdditionalProductTranslationDto {
  @IsString()
  readonly lang: string;

  @IsString()
  readonly title: string;
}

// 2️⃣ Additional product
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

// 3️⃣ Additional product group translation
export class CreateAdditionalProductGroupTranslationDto {
  @IsString()
  readonly lang: string;

  @IsString()
  readonly title: string;
}

// 4️⃣ Additional product group
export class CreateAdditionalProductGroupDto {
  @ApiProperty({ example: "checkbox", enum: additional_product_group_type })
  @IsEnum(additional_product_group_type)
  readonly type: additional_product_group_type;

  @ApiProperty({ example: false })
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
