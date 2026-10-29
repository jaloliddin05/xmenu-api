/**
 * Platform defaults written into a new venue's settings rows at signup (organization_settings and
 * organization_order_settings). They live in the database from then on, so the owner sees and edits
 * them; code that reads settings never falls back to these values. Columns not listed here start
 * empty (NULL): no brand colors, contacts or map, and no delivery zone, so delivery stays
 * unavailable until the owner draws one.
 */
export const PLATFORM_SETTINGS = {
  currency: 'UZS',
  default_language: 'ru',
  languages: ['ru', 'uz', 'en'],
};

export const PLATFORM_ORDER_SETTINGS = {
  delivery_service_fee: 0,
  min_order_delivery: 0,
  min_order_pickup: 0,
  eta_min: 20,
  eta_max: 30,
  acceptance_timeout_seconds: 300,
  payment_timeout_seconds: 900,
  max_active_orders: 5,
};
