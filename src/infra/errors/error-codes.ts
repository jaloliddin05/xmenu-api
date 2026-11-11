/**
 * Every error code the API answers with. Front-ends pick the text shown to people by `code`;
 * `message` is a neutral English hint for developers and is never shown.
 *
 * Rules (docs/API.md, "Ошибки"): a code is never renamed and never reused for another meaning. A new
 * meaning gets a new code; the old one stays here with `deprecated` naming its replacement and is
 * no longer thrown. docs/ERRORS.md is generated from this file (npm run openapi).
 */
export interface ErrorCodeSpec {
  status: number;
  /** Default `message` (English, for developers) */
  message: string;
  /** When it happens (docs/ERRORS.md, Russian like the rest of the docs) */
  when: string;
  /** Keys of `details` that may be sent; anything else is dropped by the filter */
  details?: readonly string[];
  /** Sent with `fields[]` (one entry per failed field) */
  fields?: true;
  /** Sent with `retryAfter` and the Retry-After header */
  retryAfter?: true;
  /** No longer thrown: the code that replaced it */
  deprecated?: string;
}

const spec = <T extends Record<string, ErrorCodeSpec>>(codes: T) => codes;

export const ERROR_CODES = spec({
  // Generic: framework errors and resources without a dedicated code
  bad_request: {
    status: 400,
    message: 'Bad request',
    when: 'Запрос не разобран, а точного кода нет',
  },
  invalid_body: {
    status: 400,
    message: 'Request body is not valid JSON',
    when: 'Тело запроса не JSON или обрезано',
  },
  validation_error: {
    status: 400,
    message: 'Validation failed',
    when: 'Тело, query или файл не прошли проверку; поля в `fields`',
    fields: true,
  },
  unauthorized: {
    status: 401,
    message: 'Authentication required',
    when: 'Нет токена владельца, он неверен или пользователь отключён; неверный секрет вебхука',
  },
  forbidden: {
    status: 403,
    message: 'Forbidden',
    when: 'Действие недоступно этому пользователю (нет заведения, не администратор платформы)',
  },
  not_found: {
    status: 404,
    message: 'Not found',
    when: 'Ресурс не найден или принадлежит другому заведению; неизвестный маршрут',
  },
  payload_too_large: {
    status: 413,
    message: 'Payload too large',
    when: 'Файл или тело больше лимита',
    details: ['maxBytes'],
  },
  unsupported_media_type: {
    status: 415,
    message: 'Unsupported media type',
    when: 'Неподдерживаемый `Content-Type`',
  },
  rate_limited: {
    status: 429,
    message: 'Too many requests',
    when: 'Превышен лимит запросов (по IP, номеру или пользователю)',
    retryAfter: true,
  },
  internal_error: {
    status: 500,
    message: 'Internal server error',
    when: 'Непредвиденная ошибка сервера; подробности только в логе по `requestId`',
  },
  unavailable: {
    status: 503,
    message: 'Service temporarily unavailable',
    when: 'Временный сбой (очередь, база); повторить позже',
  },
  platform_misconfigured: {
    status: 503,
    message: 'This feature is not configured on the platform',
    when: 'Функция выключена настройкой платформы (не заведения); `details.feature`: `telegram_bot`, `delivery_link`, `sms`, `domains`, `payments`, `translation`, `order_notifications`',
    details: ['feature'],
  },

  // Tenant
  tenant_required: {
    status: 400,
    message: 'X-Tenant-Id header is required',
    when: 'Клиентский запрос без заголовка `X-Tenant-Id`',
  },
  tenant_not_found: {
    status: 404,
    message: 'Tenant not found',
    when: 'Нет активного заведения с таким id (или передан slug вместо id)',
  },
  tenant_inactive: {
    status: 403,
    message: 'Tenant is inactive',
    when: 'Заведение отключено',
  },
  tenant_mismatch: {
    status: 403,
    message: 'Token belongs to another tenant',
    when: 'Токен клиента выдан другим заведением',
  },

  // Customer auth
  invalid_phone: {
    status: 400,
    message: 'Invalid phone number',
    when: 'Номер не `+998XXXXXXXXX`',
  },
  invalid_code: {
    status: 400,
    message: 'Invalid code',
    when: 'Неверный код или код не той длины',
  },
  code_expired: {
    status: 400,
    message: 'Code expired',
    when: 'Код истёк или уже использован',
  },
  too_many_attempts: {
    status: 429,
    message: 'Too many attempts',
    when: 'Исчерпаны попытки ввода кода (код сгорает) или вход владельца заблокирован',
    retryAfter: true,
  },
  invalid_name: {
    status: 400,
    message: 'Invalid name',
    when: 'Имя клиента пустое или слишком длинное',
  },
  language_not_supported: {
    status: 422,
    message: 'Language not supported',
    when: 'Язык клиента не ru, uz или en либо не включён у заведения',
  },
  registration_expired: {
    status: 400,
    message: 'Registration expired',
    when: 'Заявки нет: истекла, уже подтверждена или неизвестный id',
  },
  invalid_registration_token: {
    status: 400,
    message: 'Invalid registration token',
    when: 'Токен шага с именем неверен или истёк',
  },
  invalid_refresh_token: {
    status: 401,
    message: 'Invalid refresh token',
    when: 'Refresh-токен неизвестен, отозван, истёк или использован повторно',
  },
  missing_token: {
    status: 401,
    message: 'Access token is required',
    when: 'Клиентский маршрут без `Authorization: Bearer`',
  },
  token_expired: {
    status: 401,
    message: 'Access token expired',
    when: 'Access-токен клиента истёк (обновить через refresh)',
  },
  invalid_token: {
    status: 401,
    message: 'Invalid access token',
    when: 'Access-токен клиента неверен или сессия отозвана',
  },
  customer_blocked: {
    status: 403,
    message: 'Customer is blocked',
    when: 'Клиент заблокирован заведением',
  },
  sms_unavailable: {
    status: 503,
    message: 'SMS provider did not accept the message',
    when: 'Провайдер SMS не ответил или отказал; лимиты отправки откатываются',
  },
  telegram_unavailable: {
    status: 503,
    message: 'Telegram verification is unavailable',
    when: 'У заведения нет бота или бот не смог доставить код; предложить SMS',
  },
  invalid_telegram_data: {
    status: 401,
    message: 'Invalid Telegram data',
    when: '`initData` Mini App не прошла проверку подписи или устарела',
  },

  // Owner (staff) auth and account
  invalid_credentials: {
    status: 401,
    message: 'Invalid phone or password',
    when: 'Вход владельца: неверный телефон или пароль (ответ одинаковый)',
  },
  phone_taken: {
    status: 409,
    message: 'Phone is already registered',
    when: 'Номер уже принадлежит подтверждённому владельцу',
  },
  wrong_password: {
    status: 400,
    message: 'Current password does not match',
    when: 'Смена пароля: текущий пароль неверен',
  },

  // Addresses
  invalid_address: {
    status: 400,
    message: 'Invalid address',
    when: 'Адрес клиента не прошёл проверку',
  },
  address_not_found: {
    status: 404,
    message: 'Address not found',
    when: 'Адреса нет у этого клиента',
  },
  address_limit_reached: {
    status: 409,
    message: 'Address limit reached',
    when: 'У клиента уже максимум сохранённых адресов',
  },

  // Orders (docs/ORDERS_API.md)
  invalid_order: {
    status: 400,
    message: 'Invalid order',
    when: 'Заказ не собирается (пустой, неверное количество, нет адреса или филиала); `details.items` по позициям',
    details: ['items'],
  },
  invalid_modifiers: {
    status: 422,
    message: 'Invalid modifiers',
    when: 'Неизвестная группа или вариант допа, повтор, не выбран обязательный',
    details: ['items'],
  },
  item_unavailable: {
    status: 409,
    message: 'Some items are unavailable',
    when: 'Блюда нет или оно скрыто; `details.items`',
    details: ['items'],
  },
  price_changed: {
    status: 409,
    message: 'Prices have changed',
    when: '`expectedTotal` не совпал с суммой по ценам из базы; новые цены в `details`',
    details: ['items', 'subtotal', 'serviceFee', 'total'],
  },
  min_order_not_reached: {
    status: 422,
    message: 'Order is below the minimum amount',
    when: 'Сумма меньше минимальной; `details.minAmount`',
    details: ['minAmount'],
  },
  out_of_delivery_zone: {
    status: 422,
    message: 'Address is outside the delivery zone',
    when: 'Адрес вне зоны доставки',
  },
  fulfillment_unavailable: {
    status: 422,
    message: 'Fulfillment type is not available',
    when: 'Тип получения выключен у заведения',
  },
  branch_closed: {
    status: 409,
    message: 'Branch is closed',
    when: 'Филиал закрыт сейчас; `details.opensAt`: ближайшее открытие, ISO 8601 с датой и поясом филиала (как в `GET /branches`), `null`, если в 7 дней открытий нет',
    details: ['opensAt'],
  },
  branch_hours_not_set: {
    status: 422,
    message: 'Branch has no opening hours',
    when: 'У филиала нет расписания',
  },
  payment_method_unavailable: {
    status: 422,
    message: 'Payment method is not available',
    when: 'Способ оплаты не подключён у заведения',
  },
  idempotency_key_required: {
    status: 400,
    message: 'Idempotency-Key header is required',
    when: '`POST /orders` без заголовка `Idempotency-Key`',
  },
  idempotency_key_reused: {
    status: 409,
    message: 'Idempotency key was used for another request',
    when: 'Тот же ключ с другим телом',
  },
  too_many_active_orders: {
    status: 429,
    message: 'Too many active orders',
    when: 'У клиента слишком много незавершённых заказов',
    retryAfter: true,
  },
  cancel_not_allowed: {
    status: 409,
    message: 'Order can no longer be cancelled',
    when: 'Клиент отменяет заказ, который уже принят',
  },
  payment_not_retryable: {
    status: 409,
    message: 'Payment cannot be retried',
    when: 'Повтор оплаты для заказа не в том статусе',
  },
  order_not_found: {
    status: 404,
    message: 'Order not found',
    when: 'Заказа нет у этого клиента или заведения',
  },
  order_status_conflict: {
    status: 409,
    message: 'Action is not available in the current order status',
    when: 'Владелец: действие с заказом недоступно в его статусе; `details.status`',
    details: ['status'],
  },
  delivery_unavailable_no_zone: {
    status: 422,
    message: 'Delivery zone is not set',
    when: 'У заведения не нарисована зона доставки',
  },
  ordering_channel_disabled: {
    status: 422,
    message: 'Ordering channel is disabled',
    when: 'Канал «доставка» выключен',
  },
  ordering_not_published: {
    status: 422,
    message: 'Ordering is not published',
    when: 'Канал включён, но не опубликован',
  },

  // Venue settings and publication
  settings_missing: {
    status: 500,
    message: 'Venue settings are missing',
    when: 'Нет строки настроек заведения (ошибка данных, не клиента)',
  },
  invalid_settings: {
    status: 400,
    message: 'Invalid settings',
    when: 'Настройки заведения противоречат друг другу; поля в `fields`',
    fields: true,
  },
  invalid_slug: {
    status: 400,
    message: 'Invalid slug',
    when: 'Slug не по правилам (формат, UUID, зарезервирован)',
  },
  slug_taken: {
    status: 409,
    message: 'Slug is already taken',
    when: 'Slug занят другим заведением',
  },
  telegram_bot_required: {
    status: 422,
    message: 'Connect the venue Telegram bot first',
    when: 'Режим `miniapp`/`both` без подключённого бота',
  },
  miniapp_required: {
    status: 403,
    message: 'The venue takes orders only in its Telegram Mini App',
    when: 'Режим `miniapp`: заказ или вход гостя без заголовка `X-Telegram-Init-Data`; открыть заведение в Telegram',
  },
  miniapp_init_data_invalid: {
    status: 403,
    message: 'Telegram Mini App data is invalid or expired',
    when: 'Режимы `miniapp`/`both`: `X-Telegram-Init-Data` не подписан ботом заведения или устарел; переоткрыть Mini App',
  },
  publication_incomplete: {
    status: 409,
    message: 'Publication checklist is not complete',
    when: 'Публикация: не выполнены пункты чеклиста; `details.missing`',
    details: ['missing'],
  },

  // Venue bot
  invalid_bot_token: {
    status: 400,
    message: 'Telegram did not accept the bot token',
    when: 'Токен бота не по формату или Telegram его не принял',
  },
  bot_already_connected: {
    status: 409,
    message: 'This bot is connected to another venue',
    when: 'Бот уже подключён к другому заведению',
  },
  bot_not_connected: {
    status: 404,
    message: 'The venue has no connected Telegram bot',
    when: 'Операция с профилем бота без подключённого бота',
  },
  webhook_setup_failed: {
    status: 400,
    message: 'Telegram refused the webhook',
    when: 'Telegram не принял адрес вебхука бота',
  },
  webhook_url_not_https: {
    status: 400,
    message: 'Webhook URL is not https',
    when: 'Адрес API платформы не https',
    deprecated: 'platform_misconfigured',
  },

  // Venue domains
  invalid_host: {
    status: 400,
    message: 'Invalid host name',
    when: 'Домен не является именем хоста; поле в `fields`',
    fields: true,
  },
  reserved_host: {
    status: 400,
    message: 'Reserved host name',
    when: 'IP-адрес или зарезервированная зона; поле в `fields`',
    fields: true,
  },
  platform_host: {
    status: 400,
    message: 'Host belongs to the platform domain',
    when: 'Домен платформы или любой хост под ним; поле в `fields`',
    fields: true,
  },
  domain_taken: {
    status: 409,
    message: 'The domain is verified by another venue',
    when: 'Домен подтверждён другим заведением',
  },
  domain_not_found: {
    status: 404,
    message: 'Domain not found',
    when: 'Домена нет у этого заведения',
  },
  domain_already_added: {
    status: 409,
    message: 'The venue already has this domain',
    when: 'Домен уже добавлен этим заведением',
  },
  domain_limit_reached: {
    status: 422,
    message: 'Domain limit reached',
    when: 'У заведения уже максимум доменов; `details.limit`',
    details: ['limit'],
  },
  domain_verification_failed: {
    status: 422,
    message: 'Ownership check failed',
    when: 'Проверка TXT не прошла; `details.reason`: `record_not_found` | `token_mismatch` | `dns_error`, `details.record` ожидаемая запись',
    details: ['reason', 'record'],
  },

  // Translation
  telegram_request_failed: {
    status: 502,
    message: 'Telegram rejected the request',
    when: 'Bot API отказал в применении пункта профиля бота (`code` пункта в `lastSync`); текст ответа только в логе',
  },
  translation_failed: {
    status: 502,
    message: 'Translation service failed',
    when: 'Сервис перевода не ответил или ответил не по формату',
  },
  translation_unavailable: {
    status: 503,
    message: 'Translation is not configured',
    when: 'Перевод не настроен на платформе',
    deprecated: 'platform_misconfigured',
  },
});

export type ErrorCode = keyof typeof ERROR_CODES;

export const ERROR_CODE_LIST = Object.keys(ERROR_CODES) as ErrorCode[];

/** `details.feature` of platform_misconfigured. */
export type MisconfiguredFeature =
  | 'telegram_bot'
  | 'delivery_link'
  | 'sms'
  | 'domains'
  | 'payments'
  | 'translation'
  | 'order_notifications';

export const isErrorCode = (code: unknown): code is ErrorCode =>
  typeof code === 'string' && Object.hasOwn(ERROR_CODES, code);

/** Code of a framework HttpException that carries none of its own. */
export function codeForStatus(status: number): ErrorCode {
  const byStatus: Record<number, ErrorCode> = {
    400: 'bad_request',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not_found',
    413: 'payload_too_large',
    415: 'unsupported_media_type',
    429: 'rate_limited',
    503: 'unavailable',
  };
  return byStatus[status] ?? (status >= 500 ? 'internal_error' : 'bad_request');
}
