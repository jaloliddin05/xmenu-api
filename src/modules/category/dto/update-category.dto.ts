import { ApiProperty } from "@nestjs/swagger"
import { IsArray, IsNotEmpty, IsOptional, IsString } from "class-validator"
import { CreateCategoryTranslationDto } from "./create-category.dto";

export class UpdateCategoryDto {
    @ApiProperty({
        description: `title`,
        example: [
            {
                id:'string',
                title: 'string',
                lang: 'en'
            },
            {
                id:'string',
                title: 'string',
                lang: 'ru'
            },
             {
                id:'string',
                title: 'string',
                lang: 'uz'
            }
        ],
        required: false,
    })
    @IsOptional()
    @IsArray()
    translations: CreateCategoryTranslationDto[];
}

export default UpdateCategoryDto