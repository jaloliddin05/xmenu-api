import { ApiProperty } from "@nestjs/swagger"
import { IsString, IsOptional } from "class-validator"

class UpdateCustomerDto {
    @ApiProperty({
        description: `first_name`,
        example: '',
        required: false,
    })
    @IsOptional()
    @IsString()
    readonly first_name: string
}

export default UpdateCustomerDto