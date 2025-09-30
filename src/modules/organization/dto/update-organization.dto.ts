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
      readonly type: any
  
      @ApiProperty({
          description: `name`,
          example: '',
          required: false,
      })
      @IsOptional()
      @IsString()
      readonly name: string
}

export default UpdateOrganizationDto