import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsString, MaxLength } from "class-validator"
import { translationMaxText } from "../translation.limits"

class TranslationDto {
    @ApiProperty({
        description: `text`,
        example: '',
        required: false,
    })
    @IsNotEmpty()
    @IsString()
    @MaxLength(translationMaxText())
    readonly text: string

    @ApiProperty({
        description: `promptName`,
        example: '',
        required: false,
    })
    @IsNotEmpty()
    @IsString()
    @MaxLength(100)
    readonly promptName: string
}

export default TranslationDto