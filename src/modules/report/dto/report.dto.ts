import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';

export const REPORT_FORMATS = ['json', 'csv'] as const;

export class ReportQueryDto {
  @ApiProperty({
    description:
      'Start of the period, inclusive (ISO 8601; the dashboard sends the local midnight)',
    example: '2026-11-01T00:00:00+05:00',
  })
  @IsISO8601()
  readonly from: string;

  @ApiProperty({
    description:
      'End of the period, exclusive; after from, at most 366 days later',
    example: '2026-12-01T00:00:00+05:00',
  })
  @IsISO8601()
  readonly to: string;

  @ApiPropertyOptional({
    enum: REPORT_FORMATS,
    description:
      'csv: a file (UTF-8 with BOM, comma), column names in the request language (?lang or Accept-Language)',
  })
  @IsOptional()
  @IsIn(REPORT_FORMATS)
  readonly format?: (typeof REPORT_FORMATS)[number];

  @ApiPropertyOptional({ enum: ['ru', 'uz', 'en'] })
  @IsOptional()
  @IsIn(['ru', 'uz', 'en'])
  readonly lang?: string;
}

class CourierReportTotalsDto {
  @ApiProperty({ description: 'Shifts started in the period' }) shifts: number;
  @ApiProperty({ description: 'Shift hours; an open shift counts until now' })
  hours: number;
  @ApiProperty() deliveries: number;
  @ApiProperty({
    description:
      'Cash to hand in: delivered cash orders paid in banknotes (fixed at the reconciliation)',
  })
  cashDue: number;
  @ApiProperty({ description: 'Received by the operator (reconciled shifts)' })
  cashReceived: number;
  @ApiProperty({
    description:
      'received - due of reconciled shifts; negative: handed in less',
  })
  discrepancy: number;
  @ApiProperty({ description: 'Cash orders paid to the courier by card' })
  card: number;
  @ApiProperty({ description: 'Accrued courier pay (fixed in each order)' })
  pay: number;
  @ApiProperty({ description: 'Ended shifts waiting for the reconciliation' })
  unreconciledShifts: number;
}

class CourierReportRowDto extends CourierReportTotalsDto {
  @ApiProperty() courierId: string;
  @ApiProperty() name: string;
}

export class CourierReportDto {
  @ApiProperty({ format: 'date-time' }) from: string;
  @ApiProperty({ format: 'date-time' }) to: string;
  @ApiProperty({ type: [CourierReportRowDto] }) rows: CourierReportRowDto[];
  @ApiProperty({ type: CourierReportTotalsDto }) total: CourierReportTotalsDto;
}

class ExternalReportTotalsDto {
  @ApiProperty() orders: number;
  @ApiProperty({ description: 'What the venue paid the services' })
  cost: number;
  @ApiProperty({ description: 'Cash orders: the venue got the money (sum)' })
  cashReceived: number;
  @ApiProperty({ description: 'Cash orders: the venue did not get it (sum)' })
  cashNotReceived: number;
  @ApiProperty({ description: 'Cash orders not marked yet (sum)' })
  cashUnmarked: number;
}

class ExternalReportRowDto extends ExternalReportTotalsDto {
  @ApiProperty({ description: 'The latest spelling of the name' })
  service: string;
}

export class ExternalReportDto {
  @ApiProperty({ format: 'date-time' }) from: string;
  @ApiProperty({ format: 'date-time' }) to: string;
  @ApiProperty({ type: [ExternalReportRowDto] }) rows: ExternalReportRowDto[];
  @ApiProperty({ type: ExternalReportTotalsDto })
  total: ExternalReportTotalsDto;
}

class ProblemCountsDto {
  @ApiProperty() noAnswer: number;
  @ApiProperty() refused: number;
  @ApiProperty() cannotDeliver: number;
  @ApiProperty() returned: number;
  @ApiProperty() cancelled: number;
}

class RefusedReasonDto {
  @ApiProperty({ enum: ['changed_mind', 'wrong_order', 'quality', 'other'] })
  reason: string;
  @ApiProperty() count: number;
}

class CancelReasonDto {
  @ApiProperty({ enum: ['customer', 'restaurant', 'system'] }) by: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'As entered by the operator, or a system code (no_response)',
  })
  reason: string | null;
  @ApiProperty() count: number;
}

export class ProblemReportDto {
  @ApiProperty({ format: 'date-time' }) from: string;
  @ApiProperty({ format: 'date-time' }) to: string;
  @ApiProperty({ type: ProblemCountsDto }) counts: ProblemCountsDto;
  @ApiProperty({ type: [RefusedReasonDto] }) refusedReasons: RefusedReasonDto[];
  @ApiProperty({ type: [CancelReasonDto] }) cancelReasons: CancelReasonDto[];
}
