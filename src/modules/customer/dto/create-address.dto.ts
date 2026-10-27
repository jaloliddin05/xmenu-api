import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Bu yerda faqat TUR tekshiriladi. Uzunlik, belgilar va koordinata juftligi
 * normalizeAddressInput() da (src/infra/helper/customer/address-validators.ts)
 * — natija va xato sababi bir joyda.
 */
class CreateAddressDto {
  @ApiPropertyOptional({
    description: 'Nom: Uy, Ish... (1-50 belgi)',
    example: 'Uy',
  })
  @IsOptional()
  @IsString()
  readonly title?: string;

  @ApiProperty({
    description: "Ko'cha va uy (3-200 belgi)",
    example: 'Shamol oti ko‘chasi 42',
  })
  @IsString()
  readonly address: string;

  @ApiPropertyOptional({
    description: 'latitude -90..90; longitude bilan birga',
    example: 41.311081,
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  readonly latitude?: number;

  @ApiPropertyOptional({
    description: 'longitude -180..180; latitude bilan birga',
    example: 69.240562,
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  readonly longitude?: number;

  @ApiPropertyOptional({ description: "Pod'ezd (<=20 belgi)", example: '2' })
  @IsOptional()
  @IsString()
  readonly entrance?: string;

  @ApiPropertyOptional({ description: 'Qavat (<=20 belgi)', example: '5' })
  @IsOptional()
  @IsString()
  readonly floor?: string;

  @ApiPropertyOptional({
    description: 'Xonadon/ofis (<=20 belgi)',
    example: '17',
  })
  @IsOptional()
  @IsString()
  readonly apartment?: string;

  @ApiPropertyOptional({
    description: 'Mo‘ljal va tafsilotlar (<=250 belgi)',
    example: "Darvoza ko'k rangda",
  })
  @IsOptional()
  @IsString()
  readonly comment?: string;

  @ApiPropertyOptional({
    description:
      "Asosiy manzil qilish. Birinchi saqlangan manzil har doim asosiy bo'ladi",
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  readonly isDefault?: boolean;
}

export default CreateAddressDto;
