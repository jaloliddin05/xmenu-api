import { ApiProperty } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  IsUUID,
} from "class-validator";
import { Type } from "class-transformer";

//
// 🔹 1. Additional product translation update DTO
//
export class UpdateAdditionalProductTranslationDto {
  @ApiProperty({ example: "uuid-of-translation" })
  @IsUUID()
  readonly id: string;

  @ApiProperty({ example: "en" })
  @IsString()
  readonly lang: string;

  @ApiProperty({ example: "Ketchup" })
  @IsString()
  readonly title: string;
}

//
// 🔹 2. Additional product update DTO
//
export class UpdateAdditionalProductDto {
  @ApiProperty({ example: 4000, required: false })
  @IsOptional()
  @IsNumber()
  readonly price?: number;

  @ApiProperty({ example: "uuid-of-group", required: false })
  @IsOptional()
  @IsString()
  readonly additional_product_group_id?: string;

  @ApiProperty({
    type: [UpdateAdditionalProductTranslationDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateAdditionalProductTranslationDto)
  readonly translations?: UpdateAdditionalProductTranslationDto[];
}

//
// 🔹 3. Additional product group translation update DTO
//
export class UpdateAdditionalProductGroupTranslationDto {
  @ApiProperty({ example: "uuid-of-translation" })
  @IsUUID()
  readonly id: string;

  @ApiProperty({ example: "en" })
  @IsString()
  readonly lang: string;

  @ApiProperty({ example: "Sauce type" })
  @IsString()
  readonly title: string;
}

//
// 🔹 4. Additional product group update DTO
//
export class UpdateAdditionalProductGroupDto {
  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  readonly is_multiple?: boolean;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  readonly is_required?: boolean;

  @ApiProperty({ example: "uuid-of-product", required: false })
  @IsOptional()
  @IsString()
  readonly product_id?: string;

  @ApiProperty({
    type: [UpdateAdditionalProductGroupTranslationDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateAdditionalProductGroupTranslationDto)
  readonly translations?: UpdateAdditionalProductGroupTranslationDto[];
}
