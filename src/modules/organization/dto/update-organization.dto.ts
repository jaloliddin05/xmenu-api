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
      readonly type: string
  
      @ApiProperty({
          description: `title`,
          example: '',
          required: false,
      })
      @IsOptional()
      @IsString()
      readonly title: string
}

export default UpdateOrganizationDto