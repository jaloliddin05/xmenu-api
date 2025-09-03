import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsOptional, IsString } from "class-validator"

class CreateOrganizationDto {
    @ApiProperty({
        description: `phone`,
        example: '',
        required: false,
    })
    @IsNotEmpty()
    @IsString()
    readonly phone: string

    @ApiProperty({
        description: `password`,
        example: '',
        required: false,
    })
    @IsNotEmpty()
    @IsString()
    readonly password: string

    @ApiProperty({
        description: `title`,
        example: '',
        required: false,
    })
    @IsNotEmpty()
    @IsString()
    readonly title: string
}

export default CreateOrganizationDto