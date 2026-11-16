import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PayRateDto } from 'src/modules/order/dto/order-settings.dto';
import { CourierShiftStatus } from '@prisma/client';
import formatPhoneNumber from 'src/infra/helper/auth/format-phone';
import { PHONE_REGEX } from 'src/infra/helper/auth/customer-validators';

const toPhone = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? formatPhoneNumber(value) : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCourierDto {
  @ApiProperty({ example: 'Bekzod', maxLength: 64 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  readonly name: string;

  @ApiProperty({ example: '+998901234567' })
  @Transform(toPhone)
  @IsString()
  @Matches(PHONE_REGEX)
  readonly phone: string;
}

export class UpdateCourierDto {
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  readonly name?: string;

  @ApiPropertyOptional({ example: '+998901234567' })
  @IsOptional()
  @Transform(toPhone)
  @IsString()
  @Matches(PHONE_REGEX)
  readonly phone?: string;
}

export class AssignCourierDto {
  @ApiProperty({ description: 'A courier of the venue who is on shift' })
  @IsUUID()
  readonly courierId: string;
}

const SHIFT_STATUSES = Object.values(CourierShiftStatus);

export class ShiftListQueryDto {
  @ApiPropertyOptional({ enum: SHIFT_STATUSES })
  @IsOptional()
  @IsIn(SHIFT_STATUSES)
  readonly status?: CourierShiftStatus;
}

class CourierShiftRefDto {
  @ApiProperty() id: string;
  @ApiProperty() startedAt: string;
}

export class CourierViewDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ example: '+998901234567' }) phone: string;
  @ApiProperty({ description: 'false: disabled, no access to the bot' })
  isActive: boolean;
  @ApiProperty({ description: 'The courier opened the invitation in Telegram' })
  linked: boolean;
  @ApiProperty({
    enum: ['off_shift', 'free', 'busy'],
    description:
      'off_shift; free: on shift without orders; busy: on shift with activeOrders',
  })
  state: string;
  @ApiProperty({ description: 'Unfinished orders on the courier' })
  activeOrders: number;
  @ApiProperty({ type: CourierShiftRefDto, nullable: true })
  shift: CourierShiftRefDto | null;
  @ApiProperty() createdAt: string;
  @ApiProperty({ type: String, nullable: true }) disabledAt: string | null;
}

export class CourierInvitationDto {
  @ApiProperty({
    example: 'https://t.me/venue_bot?start=c_…',
    description:
      'One-time link to the venue bot; a newer link voids the older ones',
  })
  link: string;
  @ApiProperty({ description: 'The link works until then (24 hours)' })
  expiresAt: string;
}

class ShiftCourierDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

export class ShiftCashDto {
  @ApiProperty({ description: 'Orders the courier delivered in the shift' })
  deliveries: number;
  @ApiProperty({
    description:
      'Cash to hand in: delivered cash orders paid in banknotes; live until the reconciliation, then fixed',
  })
  due: number;
  @ApiProperty({
    description: 'Cash orders paid to the courier by card (not reconciled)',
  })
  card: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'What the operator got (reconciled only)',
  })
  received: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'received - due: negative when the courier handed in less (reconciled only)',
  })
  discrepancy: number | null;
}

export class ShiftViewDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: ShiftCourierDto }) courier: ShiftCourierDto;
  @ApiProperty({
    enum: SHIFT_STATUSES,
    description:
      'open; awaiting_reconciliation: ended, the cash is not reconciled yet; reconciled',
  })
  status: CourierShiftStatus;
  @ApiProperty() startedAt: string;
  @ApiProperty({ type: String, nullable: true }) endedAt: string | null;
  @ApiProperty({ enum: ['courier', 'staff'], nullable: true })
  endedBy: 'courier' | 'staff' | null;
  @ApiProperty({
    description: 'Unfinished orders on the courier (open shifts only)',
  })
  activeOrders: number;
  @ApiProperty({ type: ShiftCashDto }) cash: ShiftCashDto;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  reconciledAt: string | null;
}

export class ReconcileShiftDto {
  @ApiProperty({
    description: 'Cash the operator got from the courier',
    example: 250000,
  })
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  readonly received: number;
}

export class CourierPayRateDto {
  @ApiProperty({
    type: PayRateDto,
    nullable: true,
    description: "The courier's own rate; null: the venue's rate applies",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PayRateDto)
  readonly rate: PayRateDto | null;
}

export class CourierPayRateRowDto {
  @ApiProperty() courierId: string;
  @ApiProperty() name: string;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ type: PayRateDto, nullable: true }) rate: PayRateDto | null;
}

export class CourierPayRatesDto {
  @ApiProperty({
    type: PayRateDto,
    nullable: true,
    description:
      'The venue rate (PUT /order-settings courierPay); null: no pay accrued',
  })
  venue: PayRateDto | null;
  @ApiProperty({ type: [CourierPayRateRowDto] })
  couriers: CourierPayRateRowDto[];
}

export class HandToExternalDto {
  @ApiProperty({ example: 'Yandex Go', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  readonly service: string;

  @ApiProperty({
    description: 'What the venue paid the service',
    example: 25000,
  })
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  readonly cost: number;
}

export class ExternalPaymentDto {
  @ApiProperty({ description: 'Did the venue get the cash of the order?' })
  @IsBoolean()
  readonly received: boolean;
}
