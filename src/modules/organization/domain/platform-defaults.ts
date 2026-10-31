/**
 * Platform defaults written into a new venue's settings rows at signup (organization_settings and
 * organization_order_settings). They live in the database from then on, so the owner sees and edits
 * them; code that reads settings never falls back to these values (the one exception is the theme,
 * see PLATFORM_THEME). Columns not listed here start
 * empty (NULL): no brand colors, contacts or map, and no delivery zone, so delivery stays
 * unavailable until the owner draws one.
 */
export const PLATFORM_SETTINGS = {
  currency: 'UZS',
  default_language: 'ru',
  languages: ['ru', 'uz', 'en'],
};

/**
 * Neutral colors every front-end shows when the owner has not chosen one (graphite, no accent hue).
 * The single source: GET /tenant/config merges it under the stored theme, and the owner's settings
 * answer carries the merged result as `effectiveTheme` for the preview. Front-ends keep no copy.
 * Keys are exactly THEME_KEYS (organization-settings.ts); a spec guards that.
 */
export const PLATFORM_THEME = {
  background: '#FFFFFF',
  foreground: '#1A1A1A',
  surface: '#FFFFFF',
  mutedSurface: '#F4F4F4',
  muted: '#6B6B6B',
  brand: '#2B2B2B',
  brandForeground: '#FFFFFF',
  danger: '#B42318',
  serviceArea: '#4A6FA5',
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

/**
 * Channels of a new venue: the QR menu works right after signup, ordering (website and/or Mini App) is
 * off until the owner turns it on and publishes (domain/publication.ts). The website is the default
 * ordering front-end: it needs no Telegram bot.
 */
export const PLATFORM_CHANNELS = {
  qr_enabled: true,
  delivery_enabled: false,
  delivery_mode: 'site',
} as const;
