import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsOptional, IsString } from "class-validator"

class CreateOrganizationDto {
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