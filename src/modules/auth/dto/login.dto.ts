import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty } from "class-validator";

class LoginDto {
  @ApiProperty({
    description: `login`,
    example: 'admin',
  })
  @IsNotEmpty()
  @IsString()
  login: string;

  @ApiProperty({
    description: `password`,
    example: 'admin',
  })
  @IsNotEmpty()
  @IsString()
  password: string;
}

export default LoginDto