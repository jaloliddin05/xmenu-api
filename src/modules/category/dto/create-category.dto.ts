import { ApiProperty } from "@nestjs/swagger"
import { IsArray, IsNotEmpty, IsOptional, IsString } from "class-validator"

export class CreateCategoryDto {
    @ApiProperty({
        description: `title`,
        example: [
            {
                title: 'string',
                lang: 'en'
            },
            {
                title: 'string',
                lang: 'ru'
            }
        ],
        required: false,
    })
    @IsNotEmpty()
    @IsArray()
    translations: CreateCategoryTranslationDto[];

     @ApiProperty({
        description: `organization_id`,
        example: '',
        required: false,
    })
    @IsNotEmpty()
    @IsString()
    readonly organization_id: string
}

class CreateCategoryTranslationDto {
    @ApiProperty({
        description: `title`,
        example: '',
        required: false,
    })
    @IsNotEmpty()
    @IsString()
    readonly title: string

    @ApiProperty({
        description: `key`,
        example: '',
        required: false,
    })
    @IsNotEmpty()
    @IsString()
    readonly lang: string;
}

export default CreateCategoryDto