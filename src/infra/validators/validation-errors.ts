import {
  BadRequestException,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';

/** One failed field: path in the request body, constraint name and readable text. */
export interface FieldError {
  /** e.g. `theme.background`, `languages[1]`, `mapCenter.lat` */
  field: string;
  /** class-validator constraint (`matches`, `isIn`, `min`, `max`, `isInt`, …) or a domain rule */
  reason: string;
  message: string;
}

const joinPath = (parent: string, property: string) =>
  /^\d+$/.test(property)
    ? `${parent}[${property}]`
    : parent
      ? `${parent}.${property}`
      : property;

/** Flattens nested class-validator errors into one entry per failed constraint. */
export function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
): FieldError[] {
  return errors.flatMap((e) => {
    const field = joinPath(parent, e.property);
    const own = Object.entries(e.constraints ?? {}).map(
      ([reason, message]) => ({ field, reason, message }),
    );
    return [...own, ...flattenValidationErrors(e.children ?? [], field)];
  });
}

/** 400 with `code`, a readable `message` and the per-field `errors`. */
export function fieldErrorsException(
  code: string,
  errors: FieldError[],
): BadRequestException {
  return new BadRequestException({
    code,
    message:
      errors.map((e) => `${e.field}: ${e.message}`).join('; ') ||
      'Validation failed',
    errors,
  });
}

/** The API-wide pipe: unknown fields are refused, failures name the field (code validation_error). */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    exceptionFactory: (errors) =>
      fieldErrorsException('validation_error', flattenValidationErrors(errors)),
  });
}
