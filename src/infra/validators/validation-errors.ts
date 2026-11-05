import { ValidationError, ValidationPipe } from '@nestjs/common';
import { AppException, FieldError } from '../errors/app-exception';
import type { ErrorCode } from '../errors/error-codes';

export type { FieldError } from '../errors/app-exception';

/** class-validator constraint name → field code: `isIn` → `is_in`, extra field → `unknown_field`. */
export function fieldCode(constraint: string): string {
  if (constraint === 'whitelistValidation') return 'unknown_field';
  return constraint.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
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
      ([constraint, message]) => ({
        field,
        code: fieldCode(constraint),
        message,
      }),
    );
    return [...own, ...flattenValidationErrors(e.children ?? [], field)];
  });
}

/** 400 with `code`, a developer `message` and the per-field `fields`. */
export function fieldErrorsException(
  code: ErrorCode,
  fields: FieldError[],
): AppException {
  const message =
    fields.map((f) => `${f.field}: ${f.message}`).join('; ') || undefined;
  return new AppException(code, { message, fields });
}

/** One failed field (a pipe or a service check outside class-validator): 400 validation_error. */
export const fieldError = (field: string, code: string, message: string) =>
  fieldErrorsException('validation_error', [{ field, code, message }]);

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
