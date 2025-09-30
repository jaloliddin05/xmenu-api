import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsOptional, IsString } from "class-validator"

class CreateUserDto {
    @ApiProperty({
        description: `phone`,
        example: '',
        required: false,
    })
    @IsNotEmpty()
    @IsString()
    readonly phone: string

    @ApiProperty({
        description: `first_name`,
        example: '',
        required: false,
    })
    @IsNotEmpty()
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
}

export default CreateUserDto