import { ApiProperty } from '@nestjs/swagger';

export class HealthDto {
  @ApiProperty({ enum: ['ok'] })
  status: 'ok';
}

export type CheckState = 'up' | 'down';

export class ReadinessChecksDto {
  @ApiProperty({ enum: ['up', 'down'] })
  database: CheckState;

  @ApiProperty({ enum: ['up', 'down'] })
  redis: CheckState;
}

export class ReadinessDto {
  @ApiProperty({ enum: ['ok', 'unavailable'] })
  status: 'ok' | 'unavailable';

  @ApiProperty({ type: ReadinessChecksDto })
  checks: ReadinessChecksDto;
}
