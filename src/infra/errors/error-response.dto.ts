import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ERROR_CODE_LIST } from './error-codes';

/** One failed field in `fields[]` (400 validation_error and other codes with fields). */
export class FieldErrorDto {
  @ApiProperty({
    example: 'theme.brand',
    description: 'Path in the request: `theme.brand`, `languages[1]`, `file`',
  })
  field: string;

  @ApiProperty({
    example: 'matches',
    description:
      'snake_case rule: `is_in`, `max`, `max_length`, `required`, `unknown_field`, or a domain rule',
  })
  code: string;

  @ApiProperty({
    example: 'brand must be a hex color',
    description: 'English hint for developers; never shown to people',
  })
  message: string;
}

/**
 * Every error response of the API (AppErrorFilter). Texts shown to people are chosen by `code`;
 * all codes with their status and details: docs/ERRORS.md.
 */
export class ErrorResponse {
  @ApiProperty({
    enum: ERROR_CODE_LIST,
    enumName: 'ErrorCode',
    example: 'validation_error',
    description: 'Stable code (never renamed or reused), docs/ERRORS.md',
  })
  code: string;

  @ApiProperty({
    example: 'Validation failed',
    description: 'English hint for developers; never shown to people',
  })
  message: string;

  @ApiProperty({ example: 400, description: 'Same as the HTTP status' })
  status: number;

  @ApiPropertyOptional({
    type: FieldErrorDto,
    isArray: true,
    description: 'Failed fields (validation_error, invalid_settings, …)',
  })
  fields?: FieldErrorDto[];

  @ApiPropertyOptional({
    example: 60,
    description: 'Seconds to wait (429), also the Retry-After header',
  })
  retryAfter?: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Structured data of some codes (keys per code in docs/ERRORS.md), e.g. platform_misconfigured: { feature }',
  })
  details?: object;

  @ApiProperty({
    example: '3f1c2a8e-5b7d-4e0a-9c61-2d4f8b7a1e90',
    description:
      'Id of the request in the server log, also the X-Request-Id header',
  })
  requestId: string;
}
