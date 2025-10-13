import { ApiProperty } from "@nestjs/swagger"
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator"

class MoveCategoryDto {
    
  @ApiProperty({
      description: `categoryId`,
      example: '',
      required: false,
  })
  @IsNotEmpty()
  @IsString()
  categoryId: string;

  @ApiProperty({
        description: `organizationId`,
        example: '',
        required: false,
  })
  @IsNotEmpty()
  @IsString()
  organizationId: string;

  @ApiProperty({
        description: `title`,
        example: '',
         required: false,
  })
  @IsNotEmpty()
  @IsNumber()
  newIndex: number;
}


export default MoveCategoryDto