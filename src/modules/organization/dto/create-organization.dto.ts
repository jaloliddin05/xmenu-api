import { ApiProperty } from "@nestjs/swagger"
import { IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator"
import { OrganizationTypeEnum } from "../models/organization.model"

class CreateOrganizationDto {
    @ApiProperty({
        description: `type`,
        example: '',
        required: false,
    })
    @IsNotEmpty()
    @IsEnum(OrganizationTypeEnum)
    readonly type: any

    @ApiProperty({
        description: `name`,
        example: '',
        required: false,
    })
    @IsNotEmpty()
    @IsString()
    readonly name: string
}

export default CreateOrganizationDto