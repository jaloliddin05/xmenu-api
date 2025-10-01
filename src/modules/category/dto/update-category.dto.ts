import { ApiProperty } from "@nestjs/swagger"
import { IsOptional, IsBoolean } from "class-validator"

class UpdateOrganizationDto {

    @ApiProperty({ example: true, description: 'isActive' })
    @IsOptional()
    @IsBoolean()
    isActive: boolean
}

export default UpdateOrganizationDto