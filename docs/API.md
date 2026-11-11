# Xmenu API: справочник

Машиночитаемый контракт: `docs/openapi.json` (генерируется `npm run openapi`, тот же документ, что на `/docs`).
Здесь то, чего в OpenAPI не видно: сценарии, коды ошибок, лимиты. Подробно по доменам:

- заказы клиента: `ORDERS_API.md`, устройство заказов на бэкенде: `BACKEND_ORDERS.md`;
- филиалы: `BRANCHES_API.md`;
- бот заведения и подтверждение номера через Telegram: `TELEGRAM_VERIFICATION.md`;
- ревалидация QR и сайта доставки: `REVALIDATE.md`.

## Два контура авторизации

| | Владельцы (staff, админка) | Клиенты (доставка) |
|---|---|---|
| Пути | `/auth/*` и все прочие эндпоинты админки | `/auth/customer/*`, `/customers/*`, `/orders/*` |
| Тенант | организация владельца из access-токена | заголовок `X-Tenant-Id: <organization.id>` (UUID; slug не принимается) |

## Ошибки

Одна форма для обоих контуров и любого эндпоинта (схема `ErrorResponse` в OpenAPI, ответ `default` у каждой
операции):

```json
{ "code": "validation_error", "message": "theme.brand: brand must be a hex color",
  "status": 400, "fields": [{ "field": "theme.brand", "code": "matches", "message": "brand must be a hex color" }],
  "requestId": "3f1c2a8e-5b7d-4e0a-9c61-2d4f8b7a1e90" }
```

| Поле | Что это |
|---|---|
| `code` | стабильный код в snake_case из одного реестра (`src/infra/errors/error-codes.ts`); полный список с HTTP-статусом, условиями и `details`: `docs/ERRORS.md` (генерируется `npm run openapi`) |
| `message` | подсказка разработчику по-английски; не для показа людям. Текст на экране фронт выбирает по `code` из своего словаря, неизвестный `code` даёт общий текст |
| `status` | тот же HTTP-статус |
| `fields?` | ошибки полей: `field` путь в запросе (`mapCenter.lat`, `languages[1]`, `file`), `code` правило в snake_case (`matches`, `is_in`, `min`, `max`, `is_int`, `max_length`, `required`, `unknown_field` для лишнего поля, доменные `not_in_languages`, `outside_bounds`…), `message` подсказка разработчику |
| `retryAfter?` | секунды до повтора (429), вместе с заголовком `Retry-After` |
| `details?` | данные отдельных кодов, только ключи из реестра (`branch_closed`: `opensAt`, `price_changed`: новые цены…) |
| `requestId` | id запроса, тот же в заголовке `X-Request-Id`; по нему подробности в логе сервера. Входящий `X-Request-Id` от прокси сохраняется, если похож на id (`[A-Za-z0-9-]{8,64}`) |

Ответ с ошибкой всегда `Cache-Control: no-store`.

**Что не попадает в ответ.** Имена переменных окружения, пути, стектрейсы, тексты исключений, ответы внешних
сервисов (Telegram, Click, Payme, OpenAI, Eskiz) и ошибки базы уходят только в лог вместе с `requestId`. Исключения
фреймворка (неизвестный маршрут, `ParseUUIDPipe`, multer) сохраняют статус, но получают код по статусу
(`not_found`, `bad_request`…) и сообщение из реестра; всё прочее непредвиденное: `500 internal_error` без деталей.
Битый JSON: `400 invalid_body`.
Каждый ответ с ошибкой пишет в лог одну строку `[requestId] МЕТОД маршрут статус code`: `warn` для 4xx, `error` с
причиной и стеком для 5xx. Маршрут это шаблон (`/products/:id`, без значений), тела запроса в строке нет, телефоны
в тексте причины маскируются. По «Коду для поддержки» запись находится всегда. `npm run check:user-texts` (шаг CI) проверяет сообщения ошибок и тексты бота.

**Функция выключена настройкой платформы.** Если не хватает настройки платформы (не заведения), ответ
`503 platform_misconfigured` с `details.feature`:

| `feature` | Когда |
|---|---|
| `telegram_bot` | `PUT /telegram-bot`: адрес API платформы не https или ключ шифрования токенов не задан; проверка `initData` без бота заведения и платформенного бота; сохранённый токен бота не расшифровывается (сменён или потерян `PAYMENT_CONFIG_KEY`, значение повреждено): `telegram/start`, проверка `initData`, вебхук бота, `PUT /telegram-bot/profile` и `sync`. Владельцу нужно подключить бота заново (`DELETE` работает) |
| `payments` | сохранение ключей Click/Payme без ключа шифрования |
| `sms` | `otp/request` и регистрация владельца: у выбранного SMS-провайдера нет учётных данных (сбой самого провайдера остаётся `503 sms_unavailable`) |
| `domains` | добавление своего домена без `PLATFORM_DOMAIN` (только development: production без него не стартует) |
| `translation` | `/translation` без ключа OpenAI |
| `order_notifications` | вебхук платформенного бота заказов без секрета |
| `delivery_link` | не ошибка запроса: пункт синхронизации кнопки меню бота `{ status: "skipped", code: "platform_misconfigured", feature: "delivery_link" }` без адреса сайта доставки |

Какие функции выключены и почему, бэкенд печатает при старте (development) или не стартует (production);
без запуска: `npm run check:env`.

**Правила кодов.** Код не переименовывается и не используется повторно для другого смысла. Новый смысл получает
новый код; старый остаётся в реестре с пометкой `deprecated` (в `docs/ERRORS.md` зачёркнут, указана замена) и больше
не отдаётся. Устаревшие сейчас: `webhook_url_not_https` и `translation_unavailable` (оба → `platform_misconfigured`).

## Авторизация владельцев

Пока телефон не подтверждён, ничего не создаётся в БД: заявка на регистрацию ждёт в Redis (30 минут, каждая
повторная отправка продлевает). Код случайный, хранится только его HMAC, в ответах и токенах его нет.
Параметры кода общие с клиентами: `OTP_LENGTH` (6), `OTP_TTL_SECONDS` (300), `OTP_MAX_ATTEMPTS` (5),
`OTP_COOLDOWN_SECONDS` (60). Доставка кода через `SMS_PROVIDER`.

### 1. `POST /auth/register` → 201

```json
{
  "phone": "+998901234567",
  "password": "8-72 символа",
  "name": "Demo Cafe",
  "type": "restaurant | cafe | fast_food | coffee_shop | other",
  "first_name": "Aziz",
  "last_name": "Karimov"
}
```

Ответ: `{ "registrationId": "uuid", "resendAfter": 60, "codeLength": 6, "expiresIn": 300 }`.
`registrationId` не секрет: он нужен, чтобы код подтверждал именно эту заявку. Вторая регистрация на тот же номер
получает свой id и свой код и первую не перехватывает.

### 2. `POST /auth/resend-code` → 200

`{ "registrationId": "uuid" }` → `{ "resendAfter": 60, "expiresIn": 300 }`. Старый код перестаёт работать.

### 3. `POST /auth/check-code` → 200

`{ "registrationId": "uuid", "code": "123456" }` (код строкой: ведущие нули значимы).
Создаёт владельца, заведение (slug из названия) и строки настроек `organization_settings` и
`organization_order_settings` со значениями платформы по умолчанию (см. «Настройки заведения»), сразу входит:
`{ "success": true, "user": { ..., "organization": { ... } }, "accessToken": "...", "refreshToken": "..." }`.
Заявка одноразовая.

### 4. `POST /auth/login` → 200

`{ "login": "+998901234567", "password": "..." }` → `{ "accessToken", "refreshToken", "user" }`.
Телефон можно прислать с пробелами, без `+`. Неизвестный номер, неподтверждённый аккаунт и неверный пароль дают
одинаковый ответ `401 invalid_credentials` за одинаковое время.

### 5. `POST /auth/refresh` → 200

`{ "refreshToken": "..." }` (в теле, не в заголовке) → `{ accessToken, refreshToken }`. Refresh-токен непрозрачный,
хранится хешем в `staff_session` и **одноразовый**: каждый refresh выдаёт новый, старый сгорает (фронт обязан
сохранить новый). Повтор старого токена в течение 30 с (потерянный ответ, параллельные запросы) ещё работает; позже
это считается кражей: отзывается весь вход. Неизвестный, отозванный, истёкший токен или токен удалённого или
неактивного пользователя → `401 invalid_refresh_token`. Срок: 7 дней от последнего refresh, не больше 30 дней от
входа (`STAFF_REFRESH_TTL_DAYS`, `STAFF_SESSION_ABSOLUTE_DAYS`).

### 6. `POST /auth/logout` → 204

`{ "refreshToken": "..." }` отзывает вход (всю цепочку refresh-токенов этого входа); другие устройства не трогает.
Всегда 204: без токена, с неизвестным или уже отозванным токеном тоже. Access-токен (JWT) живёт до своего срока
(`JWT_ACCESS_TOKEN_EXPIRATION_TIME`, 1 ч): фронт удаляет его сам.

`user` в ответах `login` и `check-code` (и `GET /user/me`): `id, phone, email, first_name, last_name, url, isActive,
created_at, avatar_id` и `organization { id, name, slug, type, is_active, logo { id, url }, banner { id, url },
translations [{ id, lang, description }] }`. Хеша пароля, `owner_id`, `order_seq`, `int_id` и путей файлов на диске
нет.

### Коды ошибок

| HTTP | `code` | Когда |
|---|---|---|
| 400 | `validation_error` | тело не прошло DTO (пароль короче 8, неизвестный `type`...), поля в `fields` |
| 400 | `invalid_phone` | номер не `+998XXXXXXXXX` |
| 400 | `invalid_code` | неверный код или код не той длины (попытка не тратится, если формат неверен) |
| 400 | `code_expired` | код истёк или уже использован |
| 400 | `registration_expired` | заявки нет: истекла, уже подтверждена или неизвестный `registrationId` |
| 401 | `invalid_credentials` | вход: неверный телефон или пароль |
| 401 | `invalid_refresh_token` | refresh: токен неизвестен, отозван, истёк или использован повторно |
| 409 | `phone_taken` | номер уже принадлежит подтверждённому владельцу |
| 429 | `too_many_attempts` | 5 неверных кодов (код сгорает) или блокировка входа по телефону |
| 429 | `rate_limited` | лимиты отправки кода, регистраций, проверок или входов по IP |
| 503 | `sms_unavailable` | провайдер SMS не ответил; заявка не сохраняется, лимиты откатываются |
| 503 | `platform_misconfigured` | `details.feature: sms`: у SMS-провайдера платформы нет учётных данных; заявка не сохраняется |

### Лимиты

| Что | Лимит |
|---|---|
| Отправка кода на номер | 1 раз в 60 с, 5 в час, 10 в сутки |
| Отправка кода с IP | 30 в час |
| Регистраций с IP | 10 в час |
| Проверок кода | 10 за 15 мин на номер+IP, 60 за 15 мин на IP |
| Попыток входа с IP | 20 за 15 мин |
| Вход по номеру | 5 неудач за 15 мин → блокировка 60 с, далее 120, 240... до 1 ч; уровень сбрасывается после суток без блокировок или после успешного входа |

Счётчики входа ведутся и для несуществующих номеров: блокировка не выдаёт, есть ли аккаунт.
IP берётся из `X-Forwarded-For` только от локального прокси (`trust proxy = loopback`).

## Тенант: адрес → id → конфиг

Клиентские фронты (QR-меню, доставка) определяют заведение так:

1. `GET /tenant/by-slug/:slug` (публичный, без заголовков) → `{ "id": "uuid", "slug": "cafe-example" }`.
   Только активные заведения. Неизвестный, неактивный, невалидный или UUID-подобный slug → `404 tenant_not_found`.
   `Cache-Control: public, max-age=60` (slug владелец может переименовать), ошибки `no-store`.
   Сайт доставки вместо slug может передать хост, на котором его открыли: `GET /tenant/by-host/:host` (публичный) →
   `{ "id": "uuid", "slug": "mant", "name": "Mant", "primaryDomain": "order.mant.uz" }`. Тенантом считается только
   `{slug}.{PLATFORM_DOMAIN}` (ровно одна метка, те же правила slug, записи в таблице не нужно) или подтверждённый
   свой домен заведения (раздел «Домены заведения»). Регистр, порт, точка в конце и IDN нормализуются
   (`Order.Mant.uz:443` = `order.mant.uz`, `ресторан.uz` = `xn--80ajzcicfi.uz`; юникод в пути URL-кодируется).
   Неподтверждённый или неизвестный домен, другой хост платформы (`api.xmenu.uz`, `a.b.xmenu.uz`, сам `xmenu.uz`),
   неактивное заведение, IP или не-хост → `404 tenant_not_found`. `slug` бывает `null` (свой домен у заведения без
   slug). Кэш как у by-slug. Заголовки `Host` и `X-Forwarded-Host` запроса к API бэкенд тенантом не считает: хост
   приходит только параметром, от сервера сайта доставки.
2. Дальше во все клиентские запросы заголовок `X-Tenant-Id: <id>`. Принимается только UUID организации: slug в
   заголовке → `404 tenant_not_found` без запроса в БД. Нет заголовка → `400 tenant_required`, неактивное
   заведение → `403 tenant_inactive`. Id не меняется при смене slug.
3. `GET /tenant/config` (`X-Tenant-Id`, язык по `?lang=` или `Accept-Language`) → конфиг заведения.
   `Cache-Control: public, max-age=60`, `Vary: X-Tenant-Id, Accept-Language`.

```json
{
  "id": "uuid", "slug": "cafe-example", "name": "Demo Cafe", "primaryDomain": null, "type": "cafe",
  "logoUrl": "https://files.example/image/organization/logo.png", "bannerUrl": null,
  "description": "текст на языке ответа", "foundedYear": null,
  "theme": { "background": "#FFFFFF", "foreground": "#1A1A1A", "surface": "#FFFFFF", "mutedSurface": "#F4F4F4",
             "muted": "#6B6B6B", "brand": "#EE2E17", "brandForeground": "#FFFFFF", "danger": "#B42318",
             "serviceArea": "#4A6FA5" },
  "locale": { "defaultLanguage": "ru", "languages": ["ru", "uz", "en"], "currency": "UZS" },
  "contacts": { "phone": null, "telegramUsername": null, "workingHours": null, "address": null },
  "channels": { "qr": true, "auth": { "sms": true, "telegram": false }, "delivery": { "enabled": true, "mode": "site", "published": true, "miniApp": false, "botUsername": null } },
  "fulfillment": { "modes": ["pickup"], "defaultMode": "pickup", "deliveryOffered": true, "deliveryAvailable": false,
                   "deliveryUnavailableReason": "no_zone" },
  "map": { "center": [41.311081, 69.240562], "centerSource": "saved", "zoom": 15, "city": "Ташкент",
           "bounds": [[41.15, 69.0], [41.45, 69.45]], "deliveryZone": null }
}
```

- Чего владелец не заполнил, приходит `null`; сервер ничего не подставляет. Исключение — `theme`: он всегда полный
  (все 9 ключей, не `null`): цвета владельца поверх нейтральных цветов платформы (таблица ниже). Фронты своих
  нейтральных значений не держат и берут цвет из ответа.
- `primaryDomain`: самый ранний подтверждённый свой домен заведения (хост без схемы, ASCII/punycode) или `null`.
  Платформенный адрес `{slug}.{PLATFORM_DOMAIN}` работает всегда и сюда не попадает.
- `logoUrl`, `bannerUrl`: абсолютные URL от `PUBLIC_FILES_URL` (иначе `PUBLIC_API_URL`).
- `description`: на языке ответа; пустое или отсутствующее берётся на языке заведения по умолчанию, иначе `null`.
- `channels` (раздел «Каналы и публикация» ниже): `qr`: QR-меню включено владельцем (QR-фронт при `false` показывает
  «Меню недоступно», бэкенд меню не закрывает); `delivery.enabled`: владелец включил заказы (сайт и/или Mini App,
  доставка и самовывоз); `delivery.mode`: `site`, `miniapp` или `both`; `delivery.published`: заказы открыты
  (включено **и** опубликовано). При `published: false` `POST /orders` отвечает `422` (`ordering_channel_disabled` или
  `ordering_not_published`), меню, филиалы и карта отдаются как обычно (предпросмотр).
- `channels.delivery.miniApp`: у заведения есть Mini App: режим `miniapp` или `both` и бот работает (как
  `channels.auth.telegram`). `channels.delivery.botUsername`: имя бота для ссылки «Открыть в Telegram»
  (`https://t.me/<botUsername>`), только при `miniApp: true`, иначе `null`. В режиме `miniapp` вход гостя и заказ
  возможны только внутри Mini App (заголовок `X-Telegram-Init-Data`, см. «Mini App и режимы доставки»); сайт вне
  Telegram должен показать ссылку на бота вместо оформления.
- `channels.auth`: как клиент может подтвердить номер, подсказка для первого рендера; кэшируется вместе с конфигом (у
  клиента ISR), поэтому шторка входа берёт свежие значения из `GET /auth/customer/methods` (тот же расчёт, без кэша).
  `telegram`: у заведения подключён и включён бот, и его токен расшифровывается (иначе `telegram/start` отвечает `503
  telegram_unavailable` или `503 platform_misconfigured`, `feature: telegram_bot`). `sms`: у платформы настроен
  выбранный SMS-провайдер (`eskiz`: заданы `ESKIZ_EMAIL` и `ESKIZ_PASSWORD`; `telegram`: заданы `OTP_BOT` и
  `XMENU_CHAT_ID`; `console`: только вне production) или включён `OTP_DEV_MODE`; это проверка настроек, не доступности: при
  `sms: false` `otp/request` отвечает `503 platform_misconfigured` (`feature: sms`), сбой провайдера приходит ответом
  `503 sms_unavailable`. Подключение и отключение бота ставит ревалидацию `route: 'channels'`. Источник истины остаются
  сами эндпоинты.
- `fulfillment.modes`: пусто, пока `channels.delivery.published` не `true`. Иначе `pickup`, если есть активный филиал с
  самовывозом; `delivery`, если есть активный филиал с доставкой **и** задана зона доставки. Нет филиалов: `[]`,
  `defaultMode: null`. Деньги (сбор, минимум, ETA, способы оплаты) остаются в `GET /checkout-config`.
- `fulfillment.deliveryOffered`: есть активный филиал с доставкой (не зависит от публикации и зоны); `false` значит,
  что доставки у заведения нет по выбору, вкладку «Доставка» не показывать. `deliveryAvailable`: доставку можно
  заказать сейчас (`modes` содержит `delivery`). `deliveryUnavailableReason`: `null`, если доступна; иначе первая
  из причин в таком порядке: `not_offered` (нет филиала с доставкой), `channel_disabled` (владелец выключил заказы),
  `not_published` (не опубликовано или пауза), `no_zone` (зона доставки не задана).
- `map.center` `[lat, lng]`: сохранённый вид карты; если его нет, середина ограничивающего прямоугольника зоны
  доставки, иначе филиалов с координатами ((0, 0) пропускается). `null` только у заведения без зоны и без филиалов с
  координатами. Источник в `map.centerSource`: `saved`, `zone`, `branches` (`null`, если центра нет). `map.zoom`:
  сохранённый; если центр вычислен, а zoom не сохранён, подбирается по размеру зоны или филиалов (10-17, один
  филиал 16); сохранённый центр без zoom остаётся с `zoom: null`. Чеклист публикации вид карты не требует.
- В OpenAPI `theme` (всегда полный, не `null`), `platformTheme` и `effectiveTheme` описаны схемой `FullThemeDto`
  со всеми 9 ключами.
- `map.bounds` `[[юго-запад], [северо-восток]]`, `map.deliveryZone` полигон
  `[[lat, lng], ...]` или `null` (доставки нет).
- Поля `contacts.country` пока нет.

**Язык и валюта клиентских ответов** (`/menu`, `/branches`, `/orders`, `/tenant/config`): берётся первый язык из
`?lang=` или `Accept-Language`, который есть в `languages` заведения; иначе язык заведения по умолчанию. Если
перевода нет на языке ответа, берётся язык заведения по умолчанию, затем любой. Валюта (`currency` в меню, в
`/checkout-config` и в заказе) из настроек заведения.

Заведение без строки настроек (ошибка данных: строки создаются при регистрации) → `500 settings_missing`.

### Вход клиента

`GET /auth/customer/methods` (заголовок `X-Tenant-Id`, без токена) → `{ "sms": true, "telegram": false }`: способы
подтвердить номер прямо сейчас, `Cache-Control: no-store`. Поля и расчёт те же, что у `channels.auth` в
`GET /tenant/config`; клиент зовёт его при открытии шторки входа, чтобы не предлагать способ, выключенный после
сборки страницы. Оба `false`: войти нельзя (причина на стороне платформы или бота заведения), шторка показывает
общий текст. Если так у опубликованного заведения с включённым каналом, бэкенд пишет об этом в лог и в ops-чат
платформы (`OPS_CHAT_ID`), не чаще раза в час на заведение (ключ Redis `ops:guest-login-unavailable:{id}`); проверка
идёт при запросах `methods`, `GET /tenant/config` и `GET /organization/:id/publication`.

`POST /auth/customer/otp/request` → `{ "resendAfter": 60, "codeLength": 6 }`: поле ввода кода строится по
`codeLength`, а не по константе во фронте.

Альтернатива SMS: подтверждение номера через бота заведения, `POST /auth/customer/telegram/start` и
`POST /auth/customer/telegram/status` (сценарии, статусы и защита: `TELEGRAM_VERIFICATION.md`). Нет бота у
заведения → `503 telegram_unavailable`: показывать только SMS (заранее это видно в `GET /auth/customer/methods`).
Токен бота не расшифровывается → `503 platform_misconfigured` (`feature: telegram_bot`), `methods` в этом случае
отдаёт `telegram: false`. В режиме сайта вход завершается обычным
`otp/verify` с кодом из чата бота (длина кода в `codeLength` ответа `telegram/status`); в Mini App ответ `status: "verified"` уже содержит результат входа.

### Mini App и режимы доставки

Режим `channels.delivery.mode` применяется к шагам входа гостя (`otp/request`, `otp/verify`, `register`,
`telegram/start`, `login`) и к `POST /orders` через заголовок `X-Telegram-Init-Data` (сырая строка
`Telegram.WebApp.initData`). Заголовок проверяется только токеном бота заведения (не платформенным) и сроком
`TELEGRAM_INITDATA_MAX_AGE_SECONDS` от `auth_date`. `refresh`, `logout`, `me`, `telegram/status` режим не проверяют.

| Режим | Без заголовка | Заголовок неверный, просрочен или подписан другим ботом | Заголовок действителен |
|---|---|---|---|
| `site` | как обычно | не проверяется, как обычно | не проверяется, как обычно |
| `miniapp` | `403 miniapp_required` | `403 miniapp_init_data_invalid` | дальше обычные проверки |
| `both` | как обычно | `403 miniapp_init_data_invalid` | дальше обычные проверки |

- `miniapp`/`both` после удаления бота (режим остаётся, `DELETE /telegram-bot` его не меняет): `503 telegram_unavailable`.
- Коды 403, а не 401: клиент не должен обновлять токены и повторять запрос; `miniapp_required` → ссылка «Открыть в
  Telegram» (`channels.delivery.botUsername`), `miniapp_init_data_invalid` → переоткрыть Mini App.
- Порядок в `POST /orders`: канал и публикация (`422`) раньше режима.
- `login` (вход по привязанному Telegram): `initData` из тела тоже проходит проверку режима, если заголовка нет.
- `telegram/start` в Mini App: заголовка достаточно, без `initData` в теле он запускает режим `instant`.
- Проверенный заголовок на `otp/verify` и `register` привязывает Telegram-пользователя к клиенту, как `initData` в теле.
- Подтверждение номера в Mini App (`instant`) для нового номера кладёт Telegram-пользователя в `registrationToken`:
  `register` привязывает его сам, следующий `login` по `initData` входит сразу. Занятый другим клиентом Telegram-id не
  перехватывается.

## Бот заведения (владелец)

`GET /telegram-bot` → `{ connected, username, link, isEnabled, profile, isDefault, deliveryUrl, lastSync }`
(токен не возвращается никогда; адрес вебхука тоже: в нём внутренний ключ бота, он пишется в лог сервера при
подключении; без бота `profile`, `deliveryUrl`, `lastSync` = `null`).
`PUT /telegram-bot { "token": "123456:AA..." }` проверяет токен через `getMe`, ставит webhook с секретом, хранит токен
зашифрованным (`PAYMENT_CONFIG_KEY`), затем сам настраивает бота (см. ниже) и отвечает полным статусом. Сбой настройки
профиля подключение не отменяет: он виден в `lastSync`. `DELETE /telegram-bot` → 200
`{ connected: false, leftOnBot: ["name", "description", "shortDescription", "commands"] }`: кнопка меню бота
возвращается к стандартной, webhook снимается, строка бота удаляется; имя, описания и команды, выставленные
автонастройкой, остаются у бота (бот принадлежит владельцу, его настройки не сбрасываем; меняются в @BotFather),
экран отключения должен это сказать. Бота не было: `leftOnBot: []`.

### Профиль бота (автонастройка)

Профиль: `profile = { ru|uz|en: { name, description, shortDescription, menuButtonText } }`, по одному элементу на язык
заведения (`languages` настроек). Пока владелец не сохранял профиль (`isDefault: true`), значения собираются из данных
заведения: имя = название (≤64), описание = описание заведения на этом языке (иначе на языке по умолчанию, иначе
общая строка; ≤512), короткое = его начало (≤120), текст кнопки = «Меню» / «Menyu» / «Menu» (≤32).

- `PUT /telegram-bot/profile { "profile": { "ru": { ... } } }`: проверяет, сохраняет и сразу применяет. Языки, не
  присланные в теле, остаются со своими значениями. Ошибки: `400 validation_error` с `fields[]` (`ru.name` / `max_length`,
  `is_not_empty`, `is_string`, `not_in_languages`, `unknown_field`), `404 bot_not_connected`.
- `POST /telegram-bot/sync`: применить сохранённое ещё раз (после ошибки). `404 bot_not_connected`.
- Применение вызывает Bot API по пунктам, каждый независим: `setMyName`, `setMyDescription`,
  `setMyShortDescription`, `setMyCommands` (одна команда `/start`) для каждого языка и один раз без `language_code`
  (язык по умолчанию), и `setChatMenuButton` (по режиму доставки, см. ниже). Итог хранится и приходит в
  `lastSync: { syncedAt, result: { name, description, shortDescription, commands, menuButton } }`, где каждый пункт
  `{ status: "ok" | "failed" | "skipped", code?, feature? }`: `failed` с `code: "telegram_request_failed"` (Telegram отказал,
  текст ответа только в логе сервера; у имени есть лимит частоты смены), `skipped` у кнопки меню без адреса.
- Кнопка меню следует режиму доставки: `site` → стандартная кнопка Telegram (`{ type: "default" }`, пункт `ok`);
  `miniapp`/`both` → кнопка `web_app` на адрес `deliveryUrl`.
- `deliveryUrl` (адрес Mini App): `https://<primaryDomain>`, если у заведения есть подтверждённый свой домен, иначе из
  `DELIVERY_URL_TEMPLATE` (`https://{slug}.xmenu.uz`, только https); `null` в режиме `site`. Без домена и без годного
  шаблона кнопка не ставится (`{ status: "skipped", code: "platform_misconfigured", feature: "delivery_link" }`),
  остальное применяется.
- Кнопка перенастраивается сама, в фоне и без влияния на ответ: подключение бота, смена режима
  (`PUT /organization/:id/channels`), смена slug (`PUT /organization/:id`), подтверждение и удаление подтверждённого
  домена. Каждый раз отправляется полное нужное состояние (повтор безвреден); ошибки Telegram только в лог и в
  `lastSync`. Правка названия, описания или языков заведения профиль бота сама не меняет: применить вручную
  (`PUT .../profile` или `sync`).
- Аватар бота API не меняет: только в @BotFather. Приветствие `/start` в режимах `miniapp` и `both` получает кнопку
  «Открыть меню» (`web_app`, тот же адрес), в режиме `site` приходит без кнопки.

| HTTP | `code` | Когда |
|---|---|---|
| 400 | `invalid_bot_token` | токен не по формату или Telegram его не принял |
| 400 | `webhook_setup_failed` | Telegram отказал в `setWebhook`; ничего не сохранено |
| 409 | `bot_already_connected` | этот бот подключён к другому заведению |
| 503 | `platform_misconfigured` | `details.feature: telegram_bot`: адрес API платформы не https, ключ шифрования токенов не задан, или сохранённый токен не расшифровывается (`profile`, `sync`; настройка платформы, не владельца) |

Пока бот не подключён, `initData` в теле `login`, `otp/verify` и `register` проверяется платформенным ботом
(`TELEGRAM_BOT_TOKEN`); заголовок `X-Telegram-Init-Data` проверяется только ботом заведения.

### Цвета темы по умолчанию (`PLATFORM_THEME`)

Единственный источник нейтральных цветов — `src/modules/organization/domain/platform-defaults.ts`. Графитовая палитра без
акцентного оттенка:

| Ключ | Значение | Назначение |
|---|---|---|
| `background` | `#FFFFFF` | фон страницы |
| `foreground` | `#1A1A1A` | основной текст |
| `surface` | `#FFFFFF` | карточки, листы |
| `mutedSurface` | `#F4F4F4` | приглушённые блоки |
| `muted` | `#6B6B6B` | вторичный текст |
| `brand` | `#2B2B2B` | акцент (кнопки, ссылки) |
| `brandForeground` | `#FFFFFF` | текст на акценте |
| `danger` | `#B42318` | ошибки (смысловой цвет, не бренд) |
| `serviceArea` | `#4A6FA5` | зона доставки на карте |

## Настройки заведения (владелец)

`GET /organization/:id/settings` и `PUT /organization/:id/settings` (JSON, токен владельца, только своя организация).
Без токена `401`, у пользователя нет организации `403`, чужой id `404`. Ответ обоих в одной форме:

```json
{
  "theme": { "brand": "#EE2E17", "muted": "#4B494380" },
  "currency": "UZS", "defaultLanguage": "ru", "languages": ["ru", "uz", "en"],
  "supportPhone": "+998711234567", "supportTelegram": "demo_cafe", "supportHours": "10:00-23:00",
  "address": "Main street 1", "foundedYear": 2015, "city": "Tashkent",
  "mapCenter": { "lat": 41.31, "lng": 69.24 }, "mapZoom": 15,
  "mapBounds": [[41.15, 69.0], [41.45, 69.45]],
  "effectiveTheme": { "background": "#FFFFFF", "foreground": "#1A1A1A", "surface": "#FFFFFF", "mutedSurface": "#F4F4F4",
                      "muted": "#4B494380", "brand": "#EE2E17", "brandForeground": "#FFFFFF", "danger": "#B42318",
                      "serviceArea": "#4A6FA5" },
  "platformTheme": { "background": "#FFFFFF", "foreground": "#1A1A1A", "surface": "#FFFFFF", "mutedSurface": "#F4F4F4",
                      "muted": "#6B6B6B", "brand": "#2B2B2B", "brandForeground": "#FFFFFF", "danger": "#B42318",
                      "serviceArea": "#4A6FA5" }
}
```

`theme` — то, что сохранил владелец (пустой остаётся `null`, чтение ничего не подставляет). `effectiveTheme` — только в
ответе: `theme` поверх нейтральных цветов платформы, все 9 ключей, ровно то, что увидят посетители (для предпросмотра).
`platformTheme` — тоже только в ответе: нейтральные цвета платформы (9 ключей) без цветов владельца; ими становится
очищенное поле, по ним подписывается «по умолчанию» (`effectiveTheme` для этого не годится: там уже цвет владельца).
В теле `PUT` оба поля принимаются и игнорируются, поэтому ответ `GET` можно отправить обратно без правок.

`PUT` заменяет документ целиком: каждое поле обязательно, `null` очищает необязательное. После регистрации:
`UZS`, `ru`, `["ru","uz","en"]`, остальное `null`.

| Поле | Правило |
|---|---|
| `theme` | объект или `null`; только ключи из списка выше, цвета `#RGB`, `#RRGGBB`, `#RRGGBBAA`; лишний ключ → 400 |
| `currency` | `UZS` (цены в целых суммах) |
| `languages` | непустой список без повторов из `ru`, `uz`, `en` |
| `defaultLanguage` | один из `languages` |
| `supportPhone` | `+998XXXXXXXXX` |
| `supportTelegram` | username 5–32 символа, `@` в начале допускается и отбрасывается |
| `supportHours`, `address`, `city` | непустая строка до 100 / 255 / 100 символов |
| `foundedYear` | целое от 1800, не больше текущего года |
| `mapCenter` | `{ lat: -90..90, lng: -180..180 }` |
| `mapZoom` | целое 0..21 |
| `mapBounds` | `[[swLat, swLng], [neLat, neLng]]`, юго-запад строго южнее и западнее; `mapCenter` внутри, если задан |

Ошибки полей: `400 validation_error` со списком `fields` (`theme.brand`, `languages`, `mapCenter.lat`, `mapZoom`…);
несогласованные поля: `400 invalid_settings` с тем же списком (`defaultLanguage` / `not_in_languages`, `foundedYear` /
`in_future`, `mapBounds` / `invalid_bounds`, `mapCenter` / `outside_bounds`). Сохранение сразу меняет язык и валюту
клиентских ответов (кэш заведения в процессе сбрасывается; в других процессах pm2 до 30 с) и ставит ревалидацию
QR-меню и сайта доставки (`REVALIDATE.md`).

Зона доставки, сбор, минимум, ETA и тайм-ауты правятся `PUT /order-settings` (строка тоже создаётся при
регистрации; `deliveryZone: null` выключает доставку).

## Каналы и публикация (владелец)

Каналы заведения: QR-меню (включено сразу после регистрации) и заказы (канал «доставка»: заказы с сайта
`{slug}.xmenu.uz` и/или из Telegram Mini App, доставка и самовывоз; после регистрации выключен, режим `site`). Заказы
открыты, только когда канал включён **и** заведение опубликовано. Публикация проверяет чеклист, снятие публикации
(пауза) закрывает заказы, QR-меню продолжает работать. Опубликовано всегда означает включено: выключение канала
снимает публикацию, после повторного включения нужен новый `publish` с проверкой.

Эндпоинты (JSON, токен владельца, только своя организация; без токена `401`, нет организации `403`, чужой id `404`
без чтения и записи). Все четыре при успехе отвечают `200` в одной форме:

| Запрос | Что делает |
|---|---|
| `GET /organization/:id/publication` | состояние и чеклист |
| `PUT /organization/:id/channels` | заменяет каналы целиком; `delivery.enabled: false` снимает публикацию |
| `POST /organization/:id/publish` | проверяет чеклист и открывает заказы; уже опубликовано → `200`, `publishedAt` прежний |
| `POST /organization/:id/unpublish` | пауза: `published_at = null`, каналы не меняются; повтор → `200` |

```json
{
  "published": false,
  "publishedAt": null,
  "ready": false,
  "channels": { "qr": true, "delivery": { "enabled": true, "mode": "site" } },
  "checklist": [
    { "id": "delivery_channel", "status": "done", "hint": null },
    { "id": "venue_name", "status": "done", "hint": null },
    { "id": "venue_slug", "status": "done", "hint": null },
    { "id": "menu_category", "status": "done", "hint": null },
    { "id": "menu_product", "status": "todo", "hint": "Добавьте хотя бы одно активное блюдо в активную категорию" },
    { "id": "branch", "status": "todo", "hint": "Укажите у филиала часы работы (или «круглосуточно»)" },
    { "id": "delivery_zone", "status": "todo", "hint": "Нарисуйте зону доставки или отключите доставку в филиалах" },
    { "id": "telegram_bot", "status": "not_required", "hint": null }
  ],
  "warnings": [
    { "id": "guest_login_telegram_only", "hint": "Вход по SMS сейчас недоступен на платформе: гости смогут войти только через Telegram-бота заведения" }
  ]
}
```

- `published`: заказы открыты. `publishedAt`: начало текущей публикации (ISO), `null` без публикации и на паузе.
- `ready`: в чеклисте нет `todo`. Опубликованное заведение может стать неготовым (меню, филиал или зона изменены
  позже): публикация не снимается, `ready: false` показывает, что исправить, а заказ упирается в обычные проверки
  (`branch_hours_not_set`, `delivery_unavailable_no_zone` и т. д.).
- `checklist`: всегда все пункты в одном порядке. `status`: `done`, `todo` (блокирует публикацию) или
  `not_required` (пункт не относится к заведению). `hint`: что исправить, по-русски, только при `todo`; дашборд может
  показывать свои тексты по `id`.

| `id` | Выполнен, когда |
|---|---|
| `delivery_channel` | канал заказов включён (`channels.delivery.enabled`) |
| `venue_name` | название не пустое |
| `venue_slug` | slug задан и проходит проверку (3–63 символа, не зарезервирован) |
| `menu_category` | есть активная категория |
| `menu_product` | есть активное блюдо в активной категории |
| `branch` | есть активный филиал, у которого одновременно: часы работы хотя бы в один день (`is24h` подходит, `isClosed` нет), точка на карте (не `0, 0`), самовывоз или доставка |
| `delivery_zone` | задана зона (`PUT /order-settings`); `not_required`, если ни один активный филиал не принимает доставку |
| `telegram_bot` | бот заведения подключён и включён (`/telegram-bot`); `not_required` в режиме `site` |

Логотип, цвета, контакты и ключи Click/Payme публикацию не блокируют; наличные доступны всегда.

`warnings`: предупреждения отдельно от чеклиста, публикацию не блокируют (`publish` с ними проходит). Пусто, пока канал
заказов выключен. Сейчас только о входе гостей: он зависит и от платформы (SMS), поэтому пунктом чеклиста не является.
Способы входа считаются так же, как в `GET /auth/customer/methods`. `hint` по-русски; дашборд может показывать свои
тексты по `id`.

| `id` | Когда |
|---|---|
| `guest_login_telegram_only` | SMS платформы недоступен, гости входят только через бота заведения. В режиме `miniapp` не выдаётся: клиенты Mini App и так в Telegram |
| `guest_login_unavailable` | не работает ни SMS, ни бот заведения (нет, выключен, токен не расшифровывается): гости не могут войти; причина, скорее всего, на стороне платформы |

`PUT /organization/:id/channels`, тело целиком (лишние поля → `400`):

```json
{ "qr": true, "delivery": { "enabled": true, "mode": "site" } }
```

`mode`: `site`, `miniapp`, `both`. Ошибки: `400 validation_error` с `fields[]` (`qr`, `delivery`, `delivery.enabled`,
`delivery.mode`); `miniapp` или `both` без подключённого и включённого бота → `422 telegram_bot_required` (ничего не
сохраняется, даже при `enabled: false`).

`POST /organization/:id/publish` с невыполненными пунктами → `409 publication_incomplete`, ничего не пишется:

```json
{
  "code": "publication_incomplete", "message": "Publication checklist is not complete", "status": 409,
  "details": { "missing": [ { "id": "branch", "status": "todo", "hint": "Добавьте филиал: адрес, точка на карте и часы работы" } ] },
  "requestId": "…"
}
```

Параллельные запросы: запись идёт в одной транзакции с блокировкой строки организации (`SELECT … FOR UPDATE`), поэтому
`publish`, `unpublish` и `channels` одного заведения выполняются по очереди, а чеклист читается в той же транзакции.
Из параллельных `publish` время ставит ровно один (условная запись), все получают один и тот же `publishedAt`.

Реальное изменение (каналы, публикация, пауза) ставит ревалидацию QR-меню и сайта доставки с `route: "channels"`
(`REVALIDATE.md`); запрос без изменений её не ставит.

Заказы (`POST /orders`, доставка и самовывоз) при выключенном канале → `422 ordering_channel_disabled`, при
включённом без публикации или на паузе → `422 ordering_not_published`, затем режим доставки (`403
miniapp_required` / `miniapp_init_data_invalid`, «Mini App и режимы доставки»). Состояние читается из БД при каждом заказе
(не из кэша тенанта), пауза и смена режима действуют сразу. Повтор уже созданного заказа (тот же `Idempotency-Key`), отмена и
повторная оплата не блокируются.

## Домены заведения (владелец)

Свои хосты сайта доставки: `restaurant.uz`, `order.restaurant.uz`, в разработке хост туннеля (для проверки Mini App).
Платформенный адрес `{slug}.{PLATFORM_DOMAIN}` (`PLATFORM_DOMAIN` из env, например `xmenu.uz`) есть у каждого
заведения без записи. Код: `src/modules/tenant-domain/`, разбор хостов `src/modules/tenant/host.ts`.

Эндпоинты (JSON, токен владельца, только своя организация; без токена `401`, нет организации `403`, чужой id
организации `404` без чтения и записи, чужой или несуществующий id домена `404 domain_not_found`):

| Запрос | Ответ |
|---|---|
| `GET /organization/:id/domains` | `200 { platformHost, primaryDomain, limit, items: [домен] }` |
| `POST /organization/:id/domains { host }` | `201` домен (`pending`; при `DOMAIN_VERIFY_SKIP=true` сразу `verified`) |
| `POST /organization/:id/domains/:domainId/verify` | `200` домен; уже подтверждённый отвечает как есть, без проверки |
| `DELETE /organization/:id/domains/:domainId` | `204` |

```json
{
  "id": "uuid", "host": "xn--80ajzcicfi.uz", "hostUnicode": "ресторан.uz", "status": "pending", "isPrimary": false,
  "createdAt": "2026-11-04T10:00:00.000Z", "verifiedAt": null, "lastCheckAt": null, "lastCheckError": null,
  "verification": { "type": "TXT", "name": "_xmenu-verify.xn--80ajzcicfi.uz", "value": "xmenu-verify=<token>" }
}
```

- `platformHost`: `{slug}.{PLATFORM_DOMAIN}` или `null` (нет slug или `PLATFORM_DOMAIN`). `primaryDomain` и
  `isPrimary`: самый ранний подтверждённый домен (`verifiedAt`, затем `host`); отдельного выбора основного нет, его
  можно сменить только удалением. `limit`: 5 доменов на заведение, `pending` считаются.
- Хост (`POST`): только имя, без схемы, пути и порта. Регистр, точка в конце и IDN нормализуются, хранится ASCII
  (punycode) в нижнем регистре. Ошибки `400` с полем в `fields[]` (`field: "host"`, `code` = код ответа): `invalid_host`
  (не имя домена, одна метка, схема, путь, порт), `platform_host` (`PLATFORM_DOMAIN` или любой хост под ним, в том
  числе зарезервированные `api`, `qr`, `dashboard`), `reserved_host` (`localhost`, `.localhost`, `.local`,
  `.internal`, `.invalid`, `.onion`, `.arpa`, IP). Нет поля → `400 validation_error`.
- `409 domain_already_added`: у этого заведения уже есть такой хост (в любом регистре). `409 domain_taken`: хост
  подтверждён другим заведением. `422 domain_limit_reached` (`details.limit`). Неподтверждённый хост другого заведения
  добавлению не мешает: у каждого своя запись и свой токен, подтверждает тот, кто управляет DNS.
- Проверка владения: TXT-запись `_xmenu-verify.<host>` со значением `xmenu-verify=<token>` (значения в
  `verification`, запись лучше оставить и после подтверждения). Не прошла → `422 domain_verification_failed`,
  `details.reason`: `record_not_found` (нет записи или имени), `token_mismatch` (запись есть, значение другое),
  `dns_error` (тайм-аут, сбой DNS); `details.record` — ожидаемая запись. Причина и время сохраняются
  (`lastCheckError`, `lastCheckAt`). Другое заведение подтвердило хост раньше → `409 domain_taken`
  (`lastCheckError: "domain_taken"`).
- `DOMAIN_VERIFY_SKIP=true` (только разработка): DNS не проверяется, домен подтверждается при добавлении. С
  `NODE_ENV=production` приложение с этим флагом не стартует; без годного `PLATFORM_DOMAIN` в production тоже, а в
  разработке добавление домена отвечает `503 platform_misconfigured` (`feature: domains`).
- `DOMAIN_VERIFY_DNS_SERVERS` (необязательно): DNS-серверы проверки TXT через запятую, `ip[:port]` (`127.0.0.1:5353`,
  `[::1]:53`); пусто = системные резолверы. Неразбираемое значение не даёт стартовать; в production разрешено с
  предупреждением при старте. `DOMAIN_VERIFY_SKIP` от неё не зависит.
- Как этим пользуются e2e: стек `xmenu-e2e` поднимает свой фейковый DNS-сервер (UDP, отвечает на TXT из таблицы, на
  остальное `NXDOMAIN`) и запускает бэкенд с `DOMAIN_VERIFY_DNS_SERVERS=127.0.0.1:<порт>` и без `DOMAIN_VERIFY_SKIP`.
  Тест добавляет домен (`pending`), кладёт в фейковый DNS `_xmenu-verify.<host>` = `verification.value` из ответа и
  вызывает `POST …/domains/:domainId/verify` → `verified`; без записи тот же вызов даёт `422 domain_verification_failed`
  (`record_not_found`), поэтому оба сценария (`hosts`, `domains`) работают в одном стеке. Образец сервера:
  `src/modules/tenant-domain/dns-server.fake.ts` (тест бэкенда, в сборку не попадает).
- Подтверждение и удаление подтверждённого домена сбрасывают кэш тенанта и ставят ревалидацию сайта доставки
  (`route: "domains"`, `host`; `docs/REVALIDATE.md`). Добавление и удаление `pending` публично ничего не меняют.
- Подтверждённые домены повторно не проверяются (TXT можно удалить после подтверждения). TLS и nginx для своих
  доменов бэкенд не настраивает.

## Доступ к данным админки

Владелец видит и меняет только свою организацию. Любой id чужой организации (в пути или в теле: `category_id`,
`product_id`, `additional_product_group_id`, id переводов, `organizationId`...) отвечает `404`, как несуществующий.

- `/user/:id`, `/user/change-password/:id`: только свой id. Новый пароль 8–72 символа.
- `/organization/:id` (GET, PUT, DELETE) и `/organization/:id/settings`: только своя. `PUT` и `DELETE` сбрасывают
  кэш заведения (имя, slug) в своём процессе.
- `name` (регистрация, создание и `PUT /organization/:id`): после обрезки пробелов 2–100 символов, иначе
  `400 validation_error` с полем `name`. Ранее сохранённые пустые названия читаются без ошибок (чеклист: `venue_name` = `todo`).
- `slug` в `PUT /organization/:id` и `POST /organization/check-slug`: 3–63 символа `a-z`, `0-9` и одиночные
  дефисы между словами, не похож на UUID и не из зарезервированных имён (`www`, `api`, `app`, `qr`, `order`,
  `dashboard`, `admin`, `staging` и др.: slug становится поддоменом `{slug}.xmenu.uz`); иначе `400 invalid_slug`. Занят другим заведением → `409 slug_taken`.
- `/category/for-select/:organizationId`: только свой id. В `POST /category` (`organization_id`) и
  `PATCH /category/index` (`organizationId`) эти поля необязательны и должны совпадать со своей организацией.
- `POST /additional-product/group`: `product_id` необязателен (группа создаётся до блюда и привязывается через
  `additional_product_group_ids` в `POST /product`); группа принадлежит организации, которая её создала.

Удалены: `GET /user`, `POST /user`, `GET /organization`.

## Загрузка файлов, перевод, заявки, фильтр блюд

- `POST /file/upload` (multipart, поле `file`): только с токеном владельца. Принимаются JPEG, PNG, GIF, WebP;
  тип определяется по содержимому, а не по имени и MIME. SVG и всё остальное: `400`. Размер ограничен `UPLOAD_MAX_BYTES`
  (по умолчанию 5 МБ): больше → `413`. Файл пишется на диск под случайным именем с расширением по типу и только после
  проверок. Те же правила действуют для логотипа и баннера (`PUT /organization/:id`), фото блюд (`POST/PATCH /product…`)
  и аватара (`PUT /user/:id`).
- Файлы отдаются с `X-Content-Type-Options: nosniff`; всё, что не изображение, отдаётся как `attachment` с
  `Content-Security-Policy: sandbox`. Несуществующий файл: обычный `404` без пути на диске.
- `POST /translation`: только с токеном владельца. Лимит на пользователя: `TRANSLATION_RATE_LIMIT` запросов за
  `TRANSLATION_RATE_WINDOW_SECONDS` (по умолчанию 30 за 600 с) и отдельный лимит на IP клиента (все владельцы за ним):
  `TRANSLATION_IP_RATE_LIMIT` за `TRANSLATION_IP_RATE_WINDOW_SECONDS` (60 за 600 с); сверх любого лимита `429` с
  `code: rate_limited` и `retryAfter`.
  `text` до `TRANSLATION_MAX_TEXT` символов (2000), `promptName` до 100: иначе `400`. Сбой модели:
  `502 translation_failed`. Без `OPENAI_API_KEY` бэкенд стартует, а перевод отвечает `503 platform_misconfigured` (`feature: translation`).
- `GET /application`: только платформенные администраторы (`PLATFORM_ADMIN_USER_IDS`, пусто = никто): остальным `403`.
  `POST /application` остаётся публичным и отвечает только `{ id }`. Тело: `from` (`web` или `admin`) обязателен, иначе
  `400 validation_error` с полем `from` (раньше пустое тело давало `500`); `fullName` до 120 символов, `phone` до 32,
  `plan` до 64, `description` до 2000; лишние поля `400`. Не больше `APPLICATION_RATE_LIMIT` **запросов** с одного IP за
  `APPLICATION_RATE_WINDOW_SECONDS` (5 в час), дальше `429 rate_limited`; считаются и запросы, отклонённые валидацией
  (`400`): лимит стоит в guard до проверки тела, так поток мусора тоже ограничен. Заявка сохраняется всегда; уведомление в
  Telegram best-effort (сбой пишется в лог без токена, ответ `201`; без `OTP_BOT`/`XMENU_CHAT_ID` внешних вызовов нет),
  текст уходит без Markdown. Схемы `400` и `429` в OpenAPI (`ErrorResponseDto`).
- `GET /product?is_active=true|false`: фильтр по статусу блюда (параметр называется `is_active`). Другое значение: `400`,
  без параметра фильтра нет.
- Ревалидация QR и сайта доставки: формат тела и ключи заданий в `docs/REVALIDATE.md`.

## Публичные ответы (без токена)

Публичные эндпоинты отдают только явный список полей (маппер или DTO), а не строки БД.

| Эндпоинт | Раньше отдавал лишнее | Теперь |
|---|---|---|
| `GET /organization/return-slug/:id` | slug любого заведения, в том числе неактивного, по UUID или числовому `int_id` | slug (текстом) только активного заведения и только по UUID, иначе 404 |
| `POST /application` | созданную строку заявки целиком | `{ id }` |
| `POST /auth/login`, `POST /auth/check-code` | `user` без пароля, но со всеми колонками организации (`owner_id`, `order_seq`, `int_id`, пути файлов) | `user` по списку полей (см. «Авторизация владельцев») |

`GET /organization/slug/:slug` (прежнее публичное QR-меню) удалён: QR берёт заведение через `GET /tenant/by-slug/:slug`, `GET /tenant/config` и `GET /menu`; путь отвечает `404`.

`GET /tenant/by-host/:host` (новый) отдаёт по списку полей `{ id, slug, name, primaryDomain }`.

Уже были на мапперах и не менялись: `GET /tenant/by-slug/:slug`, `GET /tenant/config`, `GET /menu`, `GET /branches`,
`GET /checkout-config`, `/orders*`, `/auth/customer/*`. Вебхуки Click, Payme и Telegram отвечают в формате
провайдера.

## Лимиты публичных POST

Глобальный `PublicRateLimitGuard` (`src/infra/http/public-rate-limit.ts`) считает POST-запросы к маршрутам с `@Public()`
по IP клиента (Redis): `PUBLIC_POST_RATE_LIMIT` за `PUBLIC_POST_RATE_WINDOW_SECONDS` (120 за 60 с; мобильные операторы
делят IP, поэтому лимит щедрый). Сверх лимита: `429`, `{ "code": "rate_limited", "retryAfter": <секунды> }` и заголовок
`Retry-After`. Формат одинаков для владельцев и клиентов. Жёстче: `POST /application` (5 в час), `POST /translation`
(по IP 60 за 600 с, сверх лимита на владельца). Эндпоинты со своими лимитами (OTP, вход владельцев) продолжают
считаться по ним, общий лимит стоит над ними.

Публичные POST (метка `@Public()`, считаются):
- владельцы: `/auth/login`, `/auth/register`, `/auth/check-code`, `/auth/resend-code`, `/auth/refresh`, `/auth/logout`;
- клиенты: `/auth/customer/otp/request`, `otp/verify`, `telegram/start`, `telegram/status`, `register`, `refresh`,
  `logout`, `login`;
- прочее: `/application`. `POST /organization/check-slug` не публичный: нужен токен владельца (без него `401`), общий лимит его не считает;
- с токеном клиента (`@Public()` только чтобы обойти токен владельца): `POST /orders`, `/orders/:id/cancel`,
  `/orders/:id/payment/retry`, `POST /customers/me/addresses`, `…/:id/default`.

Не считаются (вебхуки провайдеров приходят с их адресов): `POST /payments/click/:tenantId/prepare|complete`,
`POST /payments/payme/:tenantId`, `POST /telegram/bot/:botKey/webhook`, `POST /telegram/orders/webhook`. Они защищены
подписью или секретом. Общего лимита на остальные POST владельца нет: они требуют токен.

## CORS

`main.ts`: `enableCors({ origin: true })`, то есть сервер отражает любой `Origin`, `credentials` не включён.
Почему так: авторизация только заголовком `Authorization: Bearer` (владелец) и `X-Tenant-Id` (клиент), куки бэкенд не
ставит и не читает (`res.cookie` в коде нет). Браузер не добавляет такие заголовки сам, поэтому чужая страница не может
действовать от имени посетителя, а публичные данные (меню, конфиг) и так открыты. Список разрешённых адресов вести
нечем: фронты живут на `{slug}.xmenu.uz` (любой slug), позже на доменах ресторанов.
Условия пересмотра (перейти на белый список через таблицу «хост → тенант»): появление куки или серверных сессий в
браузере, `credentials: true`, перенос токенов в `HttpOnly`-куки, эндпоинт, полагающийся на IP или сетевое положение
клиента, а не на токен.
