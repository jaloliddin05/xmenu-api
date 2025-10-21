import { ApiProperty } from "@nestjs/swagger"
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator"

class MoveProductDto {
    
  @ApiProperty({
      description: `productId`,
      example: '',
      required: false,
  })
  @IsNotEmpty()
  @IsString()
  productId: string;

  @ApiProperty({
        description: `categoryId`,
        example: '',
        required: false,
  })
  @IsNotEmpty()
  @IsString()
  categoryId: string;

  @ApiProperty({
        description: `title`,
        example: '',
         required: false,
  })
  @IsNotEmpty()
  @IsNumber()
  newIndex: number;
}


export default MoveProductDto