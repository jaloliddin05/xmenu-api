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
  // The venue has no Telegram bot connected, or the bot could not deliver the code
  | 'telegram_unavailable'
  | 'invalid_telegram_data'
  | 'invalid_address'
  | 'address_not_found'
  | 'address_limit_reached'
  | 'validation_error'
  // Owner (staff) auth: docs/API.md
  | 'invalid_credentials'
  | 'phone_taken'
  // Buyurtmalar (docs/ORDERS_API.md)
  | 'invalid_order'
  | 'invalid_modifiers'
  | 'item_unavailable'
  | 'price_changed'
  | 'min_order_not_reached'
  | 'out_of_delivery_zone'
  | 'fulfillment_unavailable'
  | 'branch_closed'
  | 'payment_method_unavailable'
  | 'idempotency_key_required'
  | 'idempotency_key_reused'
  | 'too_many_active_orders'
  | 'cancel_not_allowed'
  | 'payment_not_retryable'
  | 'order_not_found'
  | 'settings_missing'
  | 'delivery_unavailable_no_zone'
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
  telegram_unavailable: 503,
  invalid_telegram_data: 401,
  invalid_address: 400,
  address_not_found: 404,
  address_limit_reached: 409,
  validation_error: 400,
  invalid_credentials: 401,
  phone_taken: 409,
  invalid_order: 400,
  invalid_modifiers: 422,
  item_unavailable: 409,
  price_changed: 409,
  min_order_not_reached: 422,
  out_of_delivery_zone: 422,
  fulfillment_unavailable: 422,
  // The venue has not drawn a delivery zone yet: delivery is off, pickup may still work
  delivery_unavailable_no_zone: 422,
  branch_closed: 409,
  payment_method_unavailable: 422,
  idempotency_key_required: 400,
  idempotency_key_reused: 409,
  too_many_active_orders: 429,
  cancel_not_allowed: 409,
  payment_not_retryable: 409,
  order_not_found: 404,
  // A venue without its settings rows (they are created at signup): a data bug, not a client error
  settings_missing: 500,
  internal_error: 500,
};

export class CustomerAuthException extends HttpException {
  constructor(
    public readonly code: CustomerErrorCode,
    message?: string,
    public readonly retryAfter?: number,
    /** Ekran amal qila oladigan tuzilgan ma'lumot (qaysi pozitsiyalar yo'q, yangi narxlar...). */
    public readonly details?: Record<string, unknown>,
  ) {
    super({ code, message: message ?? code, retryAfter, details }, STATUS[code]);
  }
}
