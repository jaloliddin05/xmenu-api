import { HttpException } from '@nestjs/common';
import { ERROR_CODES, ErrorCode, MisconfiguredFeature } from './error-codes';

/** One failed field of `fields[]`. */
export interface FieldError {
  /** Path in the request: `theme.brand`, `languages[1]`, `file` */
  field: string;
  /** snake_case rule: `is_in`, `max`, `max_length`, `required`, `unknown_field`, a domain rule */
  code: string;
  /** English hint for developers, never shown */
  message: string;
}

export interface AppExceptionOptions {
  /** English hint for developers; the registry default otherwise. No env names, paths or error texts. */
  message?: string;
  /** Only keys listed for the code in ERROR_CODES are sent */
  details?: Record<string, unknown>;
  fields?: FieldError[];
  retryAfter?: number;
  /** Internal cause (error, missing setting): logged with the request id, never sent */
  cause?: unknown;
}

/** The one exception for errors the API answers with: status and default message from ERROR_CODES. */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly fields?: FieldError[];
  readonly retryAfter?: number;

  constructor(code: ErrorCode, options: AppExceptionOptions = {}) {
    const spec = ERROR_CODES[code];
    const { message = spec.message, details, fields, retryAfter } = options;
    super({ code, message, details, fields, retryAfter }, spec.status, {
      cause: options.cause,
    });
    this.code = code;
    this.details = details;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }
}

/**
 * A feature is off because of the platform configuration (not the venue's): 503 platform_misconfigured
 * with `details.feature`. `cause` (which setting) goes to the log only.
 */
export const platformMisconfigured = (
  feature: MisconfiguredFeature,
  cause: string,
) =>
  new AppException('platform_misconfigured', {
    details: { feature },
    cause,
  });
