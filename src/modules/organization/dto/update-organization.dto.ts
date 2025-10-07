import { ApiProperty } from "@nestjs/swagger"
import { IsString, IsOptional } from "class-validator"

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
}

export default UpdateOrganizationDto