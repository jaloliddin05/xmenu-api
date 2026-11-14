import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectOrderDto {
  @ApiPropertyOptional({ example: 'out_of_stock' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  readonly reason?: string;
}

export class SetOrderStatusDto {
  @ApiProperty({
    enum: ['accepted', 'preparing', 'on_the_way', 'ready', 'completed'],
  })
  @IsIn(['accepted', 'preparing', 'on_the_way', 'ready', 'completed'])
  readonly status:
    | 'accepted'
    | 'preparing'
    | 'on_the_way'
    | 'ready'
    | 'completed';
}
