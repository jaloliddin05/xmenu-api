import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Response schemas of GET /menu (shape built by menu.mapper.ts toMenuView)

export class MenuOptionDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'Extra cheese' }) name: string;
  @ApiProperty({ example: 3500, description: 'Whole sums, rounded' })
  price: number;
}

export class MenuOptionGroupDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'Toppings' }) title: string;
  @ApiProperty({ enum: ['single', 'multi'] }) selectionType: 'single' | 'multi';
  @ApiProperty() required: boolean;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Minimum choices; null = none',
  })
  min: number | null;
  @ApiProperty({ description: 'Maximum choices, never above the option count' })
  max: number;
  @ApiProperty({ example: 'UZS', description: "The venue's currency" })
  currency: string;
  @ApiProperty({ type: [MenuOptionDto] }) options: MenuOptionDto[];
}

export class MenuNutritionDto {
  @ApiPropertyOptional({ example: 325 }) kcal?: number;
  @ApiPropertyOptional({ example: '70 g' }) protein?: string;
  @ApiPropertyOptional({ example: '12 g' }) fat?: string;
  @ApiPropertyOptional({ example: '24 g' }) carbs?: string;
}

export class MenuItemDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'Lamb manti' }) name: string;
  @ApiProperty({ description: 'Empty string when missing' })
  description: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Absolute URL of the first image',
  })
  image: string | null;
  @ApiProperty({ type: [String], description: 'Absolute URLs' })
  images: string[];
  @ApiProperty({ example: 45000, description: 'Whole sums, rounded' })
  price: number;
  @ApiProperty({ example: 'UZS', description: "The venue's currency" })
  currency: string;
  @ApiProperty({ example: '800 g', description: 'Empty string when unknown' })
  weight: string;
  @ApiProperty({ type: MenuNutritionDto, nullable: true })
  nutrition: MenuNutritionDto | null;
  @ApiProperty({
    type: [MenuOptionGroupDto],
    description: 'Groups without options are left out',
  })
  optionGroups: MenuOptionGroupDto[];
}

export class MenuCategoryDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'Main dishes' }) title: string;
  @ApiProperty({
    type: [MenuItemDto],
    description: 'Never empty: categories without active items are left out',
  })
  items: MenuItemDto[];
}
