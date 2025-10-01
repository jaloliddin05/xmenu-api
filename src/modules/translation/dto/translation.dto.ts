import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsNumber, IsString } from "class-validator"

class TranslationDto {
    @ApiProperty({
        description: `text`,
        example: '',
        required: false,
    })
    @IsNotEmpty()
    @IsString()
    readonly text: string

    @ApiProperty({
        description: `promptName`,
        example: '',
        required: false,
    })
    @IsNotEmpty()
    @IsString()
    readonly promptName: string
}

export default TranslationDto