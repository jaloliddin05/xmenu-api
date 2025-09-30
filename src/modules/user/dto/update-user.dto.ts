import { ApiProperty } from "@nestjs/swagger"
import { IsString, IsOptional } from "class-validator"

class UpdateUserDto {
    @ApiProperty({
        description: `phone`,
        example: '',
        required: false,
    })
    @IsOptional()
    @IsString()
    readonly phone: string

    @ApiProperty({
        description: `email`,
        example: '',
        required: false,
    })
    @IsOptional()
    @IsString()
    readonly email?: string

    @ApiProperty({
        description: `first_name`,
        example: '',
        required: false,
    })
    @IsOptional()
    @IsString()
    readonly first_name: string

    @ApiProperty({
        description: `last_name`,
        example: '',
        required: false,
    })
    @IsOptional()
    @IsString()
    readonly last_name?: string

    @ApiProperty({
        description: `image`,
        example: 'image',
        type: 'string',
        format: 'binary',
        required: false,
    })
    @IsOptional()
    avatar
}

export default UpdateUserDto