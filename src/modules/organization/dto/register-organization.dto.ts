import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsOptional, IsString } from "class-validator"

class RegisterOrganizationDto {
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

export default RegisterOrganizationDto