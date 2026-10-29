# Xmenu API: справочник

Машиночитаемый контракт: `docs/openapi.json` (генерируется `npm run openapi`, тот же документ, что на `/docs`).
Здесь то, чего в OpenAPI не видно: сценарии, коды ошибок, лимиты. Подробно по доменам:

- заказы клиента: `ORDERS_API.md`, устройство заказов на бэкенде: `BACKEND_ORDERS.md`;
- филиалы: `BRANCHES_API.md`;
- ревалидация QR: `REVALIDATE.md`.

## Два контура авторизации

| | Владельцы (staff, админка) | Клиенты (доставка) |
|---|---|---|
| Пути | `/auth/*` и все прочие эндпоинты админки | `/auth/customer/*`, `/customers/*`, `/orders/*` |
| Тенант | организация владельца из access-токена | заголовок `X-Tenant-Id: <organization.id>` (UUID; slug не принимается) |
| Формат ошибки | `{ status, timestamp, message, code?, retryAfter? }` | `{ error: { code, message, retryAfter?, details? } }` |

При 429 всегда приходит заголовок `Retry-After` (секунды) и поле `retryAfter`.

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

Без изменений: `Authorization: Bearer <refreshToken>` → `{ accessToken, refreshToken }`. Токен удалённого или
неподтверждённого пользователя → 401.

В ответах нигде нет хеша пароля.

### Коды ошибок

| HTTP | `code` | Когда |
|---|---|---|
| 400 | — (`message` от валидации) | тело не прошло DTO (пароль короче 8, неизвестный `type`...) |
| 400 | `invalid_phone` | номер не `+998XXXXXXXXX` |
| 400 | `invalid_code` | неверный код или код не той длины (попытка не тратится, если формат неверен) |
| 400 | `code_expired` | код истёк или уже использован |
| 400 | `registration_expired` | заявки нет: истекла, уже подтверждена или неизвестный `registrationId` |
| 401 | `invalid_credentials` | вход: неверный телефон или пароль |
| 409 | `phone_taken` | номер уже принадлежит подтверждённому владельцу |
| 429 | `too_many_attempts` | 5 неверных кодов (код сгорает) или блокировка входа по телефону |
| 429 | `rate_limited` | лимиты отправки кода, регистраций, проверок или входов по IP |
| 503 | `sms_unavailable` | провайдер SMS не ответил; заявка не сохраняется, лимиты откатываются |

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
2. Дальше во все клиентские запросы заголовок `X-Tenant-Id: <id>`. Принимается только UUID организации: slug в
   заголовке → `404 tenant_not_found` без запроса в БД. Нет заголовка → `400 tenant_required`, неактивное
   заведение → `403 tenant_inactive`. Id не меняется при смене slug.
3. `GET /tenant/config` (`X-Tenant-Id`, язык по `?lang=` или `Accept-Language`) → конфиг заведения.
   `Cache-Control: public, max-age=60`, `Vary: X-Tenant-Id, Accept-Language`.

```json
{
  "id": "uuid", "slug": "cafe-example", "name": "Demo Cafe", "type": "cafe",
  "logoUrl": "https://files.example/image/organization/logo.png", "bannerUrl": null,
  "description": "текст на языке ответа", "foundedYear": null,
  "theme": { "brand": "#EE2E17", "brandForeground": "#FFFFFF" },
  "locale": { "defaultLanguage": "ru", "languages": ["ru", "uz", "en"], "currency": "UZS" },
  "contacts": { "phone": null, "telegramUsername": null, "workingHours": null, "address": null },
  "fulfillment": { "modes": ["pickup"], "defaultMode": "pickup" },
  "map": { "center": [41.311081, 69.240562], "zoom": 15, "city": "Ташкент",
           "bounds": [[41.15, 69.0], [41.45, 69.45]], "deliveryZone": null }
}
```

- Чего владелец не заполнил, приходит `null`; сервер ничего не подставляет. `theme` содержит только заданные цвета
  (ключи `background, foreground, surface, mutedSurface, muted, brand, brandForeground, danger, serviceArea`),
  остальное фронт берёт из своих нейтральных значений.
- `logoUrl`, `bannerUrl`: абсолютные URL от `PUBLIC_FILES_URL` (иначе `PUBLIC_API_URL`).
- `description`: на языке ответа; пустое или отсутствующее берётся на языке заведения по умолчанию, иначе `null`.
- `fulfillment.modes`: `pickup`, если есть активный филиал с самовывозом; `delivery`, если есть активный филиал с
  доставкой **и** задана зона доставки. Нет филиалов: `[]`, `defaultMode: null`. Деньги (сбор, минимум, ETA,
  способы оплаты) остаются в `GET /checkout-config`.
- `map.center` `[lat, lng]`, `map.bounds` `[[юго-запад], [северо-восток]]`, `map.deliveryZone` полигон
  `[[lat, lng], ...]` или `null` (доставки нет).
- Полей `contacts.country` и каналов (`channels`) пока нет.

**Язык и валюта клиентских ответов** (`/menu`, `/branches`, `/orders`, `/tenant/config`): берётся первый язык из
`?lang=` или `Accept-Language`, который есть в `languages` заведения; иначе язык заведения по умолчанию. Если
перевода нет на языке ответа, берётся язык заведения по умолчанию, затем любой. Валюта (`currency` в меню, в
`/checkout-config` и в заказе) из настроек заведения.

Заведение без строки настроек (ошибка данных: строки создаются при регистрации) → `500 settings_missing`.

### Вход клиента

`POST /auth/customer/otp/request` → `{ "resendAfter": 60, "codeLength": 6 }`: поле ввода кода строится по
`codeLength`, а не по константе во фронте.

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
  "mapBounds": [[41.15, 69.0], [41.45, 69.45]]
}
```

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

Ошибки полей: `400` с текстом валидации; несогласованные поля (язык по умолчанию вне списка, год в будущем,
границы, центр вне границ): `400`, `code: invalid_settings`. Сохранение сразу меняет язык и валюту клиентских
ответов (кэш заведения в процессе сбрасывается; в других процессах pm2 до 30 с).

Зона доставки, сбор, минимум, ETA и тайм-ауты правятся `PUT /order-settings` (строка тоже создаётся при
регистрации; `deliveryZone: null` выключает доставку).

## Доступ к данным админки

Владелец видит и меняет только свою организацию. Любой id чужой организации (в пути или в теле: `category_id`,
`product_id`, `additional_product_group_id`, id переводов, `organizationId`...) отвечает `404`, как несуществующий.

- `/user/:id`, `/user/change-password/:id`: только свой id. Новый пароль 8–72 символа.
- `/organization/:id` (GET, PUT, DELETE) и `/organization/:id/settings`: только своя. Публичные
  `GET /organization/slug/:slug` и `GET /organization/return-slug/:id` без изменений.
- `slug` в `PUT /organization/:id` и `POST /organization/check-slug`: 3–63 символа `a-z`, `0-9` и одиночные
  дефисы между словами, не похож на UUID; иначе `400 invalid_slug`. Занят другим заведением → `409 slug_taken`.
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
  `TRANSLATION_RATE_WINDOW_SECONDS` (по умолчанию 30 за 600 с), сверх лимита `429` с `code: rate_limited` и `retryAfter`.
  `text` до `TRANSLATION_MAX_TEXT` символов (2000), `promptName` до 100: иначе `400`. Сбой модели: `502`.
- `GET /application`: только платформенные администраторы (`PLATFORM_ADMIN_USER_IDS`, пусто = никто): остальным `403`.
  `POST /application` остаётся публичным.
- `GET /product?is_active=true|false`: фильтр по статусу блюда (параметр называется `is_active`). Другое значение: `400`,
  без параметра фильтра нет.
- Ревалидация QR: формат тела и ключи заданий в `docs/REVALIDATE.md`.
