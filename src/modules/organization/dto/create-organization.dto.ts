import { ApiProperty } from "@nestjs/swagger"
import { Transform } from "class-transformer"
import { IsEnum, IsNotEmpty, IsString, Length } from "class-validator"
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
    @IsString()
    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @Length(2, 100)
    readonly name: string
}

export default CreateOrganizationDto