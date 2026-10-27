import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE = /^\+998\d{9}$/;

export class CreateBranchDto {
  @ApiProperty({ example: 'Mant 24/7 — Chilonzor' })
  @IsString() @MinLength(1) @MaxLength(120)
  readonly title: string;

  @ApiProperty({ example: 'г. Ташкент, Чиланзарский р-н, ул. Бунёдкор, 12' })
  @IsString() @MinLength(3) @MaxLength(250)
  readonly address: string;

  @ApiProperty({ example: 41.2856 })
  @IsLatitude()
  readonly latitude: number;

  @ApiProperty({ example: 69.2034 })
  @IsLongitude()
  readonly longitude: number;

  @ApiPropertyOptional({ example: '+998711234567', description: "Filial telefoni (eskalatsiya SMS'i shu raqamga)" })
  @IsOptional() @Matches(PHONE, { message: 'phone must be +998XXXXXXXXX' })
  readonly phone?: string;

  @ApiPropertyOptional({ example: 'Asia/Tashkent' })
  @IsOptional() @IsString() @MaxLength(60)
  readonly timezone?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional() @IsInt() @Min(0)
  readonly sortOrder?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() readonly acceptsPickup?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() readonly acceptsDelivery?: boolean;

  @ApiPropertyOptional({ example: '-1001234567890', description: "Buyurtma xabarlari yuboriladigan Telegram guruh id'si (bot a'zo bo'lishi shart)" })
  @IsOptional() @IsString() @MaxLength(40)
  readonly telegramChatId?: string;
}

export class UpdateBranchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) readonly title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(250) readonly address?: string;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() readonly latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() readonly longitude?: number;
  @ApiPropertyOptional() @IsOptional() @Matches(PHONE) readonly phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) readonly timezone?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) readonly sortOrder?: number;
  @ApiPropertyOptional({ description: 'false — mijozlarga ko\'rinmaydi va buyurtma qabul qilmaydi' })
  @IsOptional() @IsBoolean() readonly isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() readonly acceptsPickup?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() readonly acceptsDelivery?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) readonly telegramChatId?: string;
}

export class WorkingDayDto {
  @ApiProperty({ example: 1, description: '1 = dushanba ... 7 = yakshanba' })
  @IsInt() @Min(1) @Max(7)
  readonly weekday: number;

  @ApiPropertyOptional({ example: '09:00' }) @IsOptional() @Matches(HHMM) readonly opensAt?: string;
  @ApiPropertyOptional({ example: '23:00', description: 'opensAt dan kichik/teng bo\'lsa — ertasi kuni yopiladi' })
  @IsOptional() @Matches(HHMM) readonly closesAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() readonly is24h?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() readonly isClosed?: boolean;
}

export class SetWorkingHoursDto {
  @ApiProperty({ type: [WorkingDayDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7)
  @ValidateNested({ each: true }) @Type(() => WorkingDayDto)
  readonly days: WorkingDayDto[];
}

export class CreateHoursExceptionDto {
  @ApiProperty({ example: '2026-12-31', description: 'Filial vaqt zonasidagi sana' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  readonly date: string;

  @ApiPropertyOptional() @IsOptional() @Matches(HHMM) readonly opensAt?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(HHMM) readonly closesAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() readonly is24h?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() readonly isClosed?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) readonly note?: string;
}
