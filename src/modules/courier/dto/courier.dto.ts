import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
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
}
