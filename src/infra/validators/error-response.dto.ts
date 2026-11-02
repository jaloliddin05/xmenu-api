import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One failed field in `errors[]` (400 validation_error). */
export class FieldErrorDto {
  @ApiProperty({ example: 'name', description: 'Path in the request body, e.g. `theme.brand`, `languages[1]`' })
  field: string;

  @ApiProperty({ example: 'length', description: 'Constraint name or domain rule' })
  reason: string;

  @ApiProperty({ example: 'name must be longer than or equal to 2 characters' })
  message: string;
}

/** Owner API error shape written by ErrorFilter: `code` is always present. */
export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  status: number;

  @ApiProperty({ format: 'date-time' })
  timestamp: string;

  @ApiProperty({ example: 'validation_error', description: 'Stable machine-readable code' })
  code: string;

  @ApiProperty({ example: 'Validation failed' })
  message: string;

  @ApiPropertyOptional({ type: FieldErrorDto, isArray: true, description: 'Failed fields (400 validation_error)' })
  errors?: FieldErrorDto[];

  @ApiPropertyOptional({ example: 3600, description: 'Seconds to wait (429 rate_limited), also the Retry-After header' })
  retryAfter?: number;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'Extra data of some codes' })
  details?: Record<string, unknown>;
}
