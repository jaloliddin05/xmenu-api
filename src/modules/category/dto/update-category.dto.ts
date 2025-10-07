import { ApiProperty } from "@nestjs/swagger"
import { IsOptional, IsBoolean } from "class-validator"

class UpdateCategoryDto {

    @ApiProperty({ example: true, description: 'isActive' })
    @IsOptional()
    @IsBoolean()
    isActive: boolean
}

export default UpdateCategoryDto