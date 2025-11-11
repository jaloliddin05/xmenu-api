import { ApiProperty } from "@nestjs/swagger"
import { Type } from "class-transformer";
import { IsString, IsOptional, IsUUID, IsArray, ValidateNested } from "class-validator"

class UpdateOrganizationTranslationDto {
  @ApiProperty({ example: "translation-uuid" })
  @IsUUID()
  readonly id: string; // mavjud translation ID

  @ApiProperty({ example: "en" })
  @IsString()
  readonly lang: string;

  @ApiProperty({ example: "Fresh and healthy", required: false })
  @IsOptional()
  @IsString()
  readonly description?: string;
}


class UpdateOrganizationDto {
    @ApiProperty({
        description: `type`,
        example: '',
        required: false,
    })
    @IsOptional()
    @IsString()
    type: string

    @ApiProperty({
        description: `name`,
        example: '',
        required: false,
    })
    @IsOptional()
    @IsString()
    readonly name: string

    @ApiProperty({
        description: `logo`,
        example: 'image',
        type: 'string',
        format: 'binary',
        required: false,
    })
    @IsOptional()
    logo

    @ApiProperty({
        description: `banner`,
        example: 'image',
        type: 'string',
        format: 'binary',
        required: false,
    })
    @IsOptional()
    banner

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
    @Type(() => UpdateOrganizationTranslationDto)
    readonly translations?: UpdateOrganizationTranslationDto[];
}

export default UpdateOrganizationDto