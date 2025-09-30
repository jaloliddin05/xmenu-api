import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsOptional, IsString } from "class-validator"

class CreateOrganizationDto {
    @ApiProperty({
        description: `type`,
        example: '',
        required: false,
    })
    @IsNotEmpty()
    @IsString()
    readonly type: string

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