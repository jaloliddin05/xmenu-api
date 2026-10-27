import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AcceptOrderDto {
  @ApiPropertyOptional({ description: "ETA ni o'zgartirish (daqiqa)" }) @IsOptional() @IsInt() @Min(1) @Max(600)
  readonly etaMin?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(600)
  readonly etaMax?: number;
}

export class RejectOrderDto {
  @ApiPropertyOptional({ example: 'out_of_stock' }) @IsOptional() @IsString() @MaxLength(200)
  readonly reason?: string;
}

export class SetOrderStatusDto {
  @ApiProperty({ enum: ['accepted', 'preparing', 'on_the_way', 'ready', 'completed'] })
  @IsIn(['accepted', 'preparing', 'on_the_way', 'ready', 'completed'])
  readonly status: 'accepted' | 'preparing' | 'on_the_way' | 'ready' | 'completed';
}
