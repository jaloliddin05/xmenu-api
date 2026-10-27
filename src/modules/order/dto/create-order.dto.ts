import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class OrderModifierDto {
  @ApiProperty() @IsString() @MaxLength(64)
  readonly groupId: string;

  @ApiProperty({ type: [String] })
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(64, { each: true })
  readonly optionIds: string[];
}

export class OrderItemDto {
  @ApiProperty() @IsString() @MaxLength(64)
  readonly itemId: string;

  @ApiProperty({ minimum: 1, maximum: 50 })
  @IsInt() @Min(1) @Max(50)
  readonly quantity: number;

  @ApiPropertyOptional({ type: [OrderModifierDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(30)
  @ValidateNested({ each: true }) @Type(() => OrderModifierDto)
  readonly modifiers?: OrderModifierDto[];
}

export class CreateOrderDto {
  @ApiProperty({ enum: ['delivery', 'pickup'] })
  @IsIn(['delivery', 'pickup'])
  readonly fulfillmentMode: 'delivery' | 'pickup';

  @ApiPropertyOptional({ description: "pickup: majburiy (olib ketish filiali). delivery: maslahat — server boshqa filialga yo'naltirishi mumkin" })
  @IsOptional() @IsString() @MaxLength(64)
  readonly branchId?: string;

  @ApiPropertyOptional({ description: 'delivery uchun majburiy: mijozning saqlangan manzili' })
  @IsOptional() @IsString() @MaxLength(64)
  readonly addressId?: string;

  @ApiProperty({ example: '+998901234567' })
  @Matches(/^\+998\d{9}$/, { message: 'phone must be +998XXXXXXXXX' })
  readonly phone: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  readonly comment?: string;

  @ApiProperty({ enum: ['cash', 'click', 'payme'] })
  @IsIn(['cash', 'click', 'payme'])
  readonly paymentMethod: 'cash' | 'click' | 'payme';

  @ApiProperty({ type: [OrderItemDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
  @ValidateNested({ each: true }) @Type(() => OrderItemDto)
  readonly items: OrderItemDto[];

  @ApiPropertyOptional({ description: "Mijoz ko'rgan jami summa. Serverdagi bilan farq qilsa 409 price_changed" })
  @IsOptional() @IsInt() @Min(0)
  readonly expectedTotal?: number;
}
