import { HttpException } from '@nestjs/common';

export type CustomerErrorCode =
  | 'tenant_required'
  | 'tenant_not_found'
  | 'tenant_inactive'
  | 'invalid_phone'
  | 'invalid_code'
  | 'code_expired'
  | 'too_many_attempts'
  | 'rate_limited'
  | 'invalid_name'
  | 'registration_expired'
  | 'invalid_registration_token'
  | 'invalid_refresh_token'
  | 'missing_token'
  | 'token_expired'
  | 'invalid_token'
  | 'customer_blocked'
  | 'tenant_mismatch'
  | 'sms_unavailable'
  | 'invalid_telegram_data'
  | 'validation_error'
  | 'internal_error';

const STATUS: Record<CustomerErrorCode, number> = {
  tenant_required: 400,
  tenant_not_found: 404,
  tenant_inactive: 403,
  invalid_phone: 400,
  invalid_code: 400,
  code_expired: 400,
  too_many_attempts: 429,
  rate_limited: 429,
  invalid_name: 400,
  registration_expired: 400,
  invalid_registration_token: 400,
  invalid_refresh_token: 401,
  missing_token: 401,
  token_expired: 401,
  invalid_token: 401,
  customer_blocked: 403,
  tenant_mismatch: 403,
  sms_unavailable: 503,
  invalid_telegram_data: 401,
  validation_error: 400,
  internal_error: 500,
};

export class CustomerAuthException extends HttpException {
  constructor(
    public readonly code: CustomerErrorCode,
    message?: string,
    public readonly retryAfter?: number,
  ) {
    super({ code, message: message ?? code, retryAfter }, STATUS[code]);
  }
}
