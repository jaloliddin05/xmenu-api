# xmenu-backend: единый API (api.xmenu.uz)

Общий контекст, решения и очередь задач: `../CLAUDE.md`. Обслуживает админку, QR-меню и клиентский фронт доставки.
Стадия: разработка и тестирование MVP; прода, клиентов и реальных данных нет, обратная совместимость не нужна.

## Стек
NestJS 11, TypeScript, Prisma 6 + PostgreSQL 16, Redis + BullMQ, Passport (JWT), class-validator,
Swagger (`/docs`), Jest. Prettier: одинарные кавычки, trailing comma `all`, отступ 2 пробела, с `;`.
Комментарии частично на узбекском, документация на русском; новые комментарии на английском.

## Команды
`npm run start:dev` · `npm run build` · `npm run lint` · `npm test` · `npm run test:e2e` · `npm run openapi`
(`openapi` собирает проект и пишет `docs/openapi.json` из сборки, без БД и Redis; `docs/API.md` правится руками).
Миграции: `npm run migrate` (собирает схему и запускает `prisma migrate dev`), на сервере `npx prisma migrate deploy`.
Env: см. `.env.example` (полный). Ключевые: `JWT_*`, `OTP_*`, `SMS_PROVIDER`, `PAYMENT_CONFIG_KEY`, `REDIS_URL`, `PUBLIC_API_URL`, `PUBLIC_FILES_URL`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ORDERS_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OPS_CHAT_ID`, `ORDER_QUEUES`,
`MINIAPP_URL`, `UPLOAD_MAX_BYTES`, `PLATFORM_ADMIN_USER_IDS`, `TRANSLATION_*`.

## Схема Prisma
Не правь `prisma/schema.prisma` руками: он собирается из `src/modules/*/models/*.prisma` командой
`npm run generate-schema`. Меняй модельные файлы, потом `npm run migrate`.

## Модули
`auth` (два контура: staff и customer), `tenant` (`TenantGuard`, `TenantService`: тенант по id; `GET /tenant/by-slug`,
`GET /tenant/config` в `TenantConfigModule`), `organization` (+ настройки заведения), `user`, `employee` (пока не
используется), `branch`, `category`, `product` (+ группы допов), `menu` (публичный), `customer` (+ адреса),
`order` (state machine, очереди, уведомления), `payment` (Click, Payme, ключи тенанта, возвраты),
`sms` (провайдеры eskiz, telegram, console), `file`, `translation`, `application`,
`revalidate-queue` (инвалидация кэша QR).

## Контракт API
Единое место: `docs/API.md` и `docs/openapi.json`. Подробности: `docs/ORDERS_API.md`, `docs/BRANCHES_API.md`,
`docs/BACKEND_ORDERS.md` (`docs/TELEGRAM_VERIFICATION.md` в репозитории нет). Меняешь контроллер или DTO: добавь `@ApiProperty` и
`@ApiOperation`, запусти `npm run openapi`, закоммить результат вместе с кодом. Проверки контракта в CI пока нет
(в `.github/workflows` только `deploy.yml`).

## Тенантность
- Тенант только по `organization.id` (UUID, не меняется): `parseTenantId` (`tenant/tenant-key.ts`), `TenantService.resolve`
  (кэш 30 с, `invalidate(id)`), `TenantGuard` по `X-Tenant-Id`. Slug в заголовке → `tenant_not_found` без запроса в БД.
  Запасного пути по slug нет. Вебхуки оплаты по id: `payments/click/:tenantId`, `payments/payme/:tenantId`.
- `GET /tenant/by-slug/:slug` → `{ id, slug }` (только активные). `GET /tenant/config` → публичный конфиг
  (`tenant-config.service.ts`): незаполненное `null`, `delivery` в режимах только при заданной зоне.
- Slug: `organization/domain/slug.ts` (3–63 символа, `a-z0-9` и дефисы, не UUID), дубликат → 409 `slug_taken`.
- `Tenant` несёт `defaultLanguage`, `languages`, `currency` из `organization_settings`: язык ответа
  `resolveLang(req, tenant)`, запасной язык перевода `pickTranslation(list, lang, tenant.defaultLanguage)`, валюта
  меню, `/checkout-config` и заказа из настроек. Константы `'ru'` и `'UZS'` в коде ответов не используются.
- Тенант и клиент берутся из токена и заголовка, не из тела запроса. Каждый запрос и выборка привязаны к тенанту.
- Платёжные ключи и токены ботов шифруются AES-256-GCM (`PAYMENT_CONFIG_KEY`). Потеря ключа: все вводят заново.

## Настройки заведения
- `organization_settings` (бренд, валюта, языки, контакты, карта) и `organization_order_settings` (сбор, минимумы,
  ETA, тайм-ауты, зона): по одной строке на заведение, обе создаются в `OrganizationService.create` при регистрации
  значениями из `organization/domain/platform-defaults.ts`. У колонок нет `DEFAULT` в БД.
- Чтение никогда не подставляет значения: нет строки → `settings_missing` (500) с логом.
- Владелец: `GET/PUT /organization/:id/settings` (PUT заменяет документ целиком, проверки в
  `organization/domain/organization-settings.ts` и DTO), `GET/PUT /order-settings`.
- Нет зоны доставки (`delivery_zone = null`) → доставка недоступна: `POST /orders` отвечает
  `422 delivery_unavailable_no_zone`.

## Заказы
`OrderTransitionService` единственный путь смены статуса (автомат, optimistic locking по `version`, журнал).
Оплату подтверждает только вебхук провайдера. Эскалация: 45 с повтор в Telegram, 120 с SMS, 300 с авто-отмена и
возврат (робозвонка нет; шаг `esc-call` на 180 с шлёт ops-алерт). Click возвращает автоматически,
Payme вручную через ops-чат.

## Авторизация клиентов
Телефон + OTP (HMAC-хеш кода, TTL, лимит попыток, cooldown) через `SmsProvider`; refresh-токены с ротацией и
сессиями. `CustomerOtpService.issue()` не зависит от канала доставки (SMS или Telegram), лимиты по телефону общие.
Целевые параметры: `OTP_LENGTH=6`, `OTP_TTL_SECONDS=300`, `OTP_MAX_ATTEMPTS=5`, `OTP_COOLDOWN_SECONDS=60`
По умолчанию 6; клиент и дашборд пока ждут 4.
`TelegramInitDataService` проверяет `initData` токеном бота тенанта (иначе платформенным) и входом не является.

## Подтверждение номера через Telegram (не реализовано: план)
В коде нет `TelegramVerificationService`, `TelegramBotWebhookController`, `TelegramBotService`, `PUT /telegram-bot`
и `docs/TELEGRAM_VERIFICATION.md`. Сейчас есть только платформенный бот заказов (`telegram-orders.controller.ts`)
и `TelegramInitDataService`. Ниже описана цель.
`TelegramVerificationService` + `TelegramBotWebhookController` (`POST /telegram/bot/:botKey/webhook`), боты ресторанов в
`TelegramBotService` (`PUT /telegram-bot` из админки). Два режима: Mini App (`instant`, сессия привязана к
Telegram-пользователю из `initData`) и сайт (`code`, код приходит в чат бота только при совпадении номера). Сессии в
Redis (`tgv:*`). Подробно: `docs/TELEGRAM_VERIFICATION.md`. Контакт принимается только если `contact.user_id == from.id`.

## Авторизация владельцев (staff)
Контракт, ошибки и лимиты: `docs/API.md`. Код: `StaffAuthService` (регистрация и вход),
`StaffLoginThrottleService` (блокировка), `StaffAuthEventService` (аудит в `staff_auth_event`).
- `POST /auth/register` ничего не пишет в БД: заявка (с bcrypt-хешем пароля владельца, 8–72 символа) ждёт в Redis
  под случайным `registrationId` 30 минут. `check-code {registrationId, code}` создаёт user и organization в одной
  транзакции; «хвост» старой схемы (`isActive=false`) переиспользуется. Код привязан к заявке, а не к номеру: вторая
  регистрация на тот же номер не может перехватить первую.
- Код выдаёт `CustomerOtpService` со `scope: 'staff'` (ключи `sotp:*`, свои лимиты, те же `OTP_*`), доставка через
  `SmsProvider`. `SMS_PROVIDER=console` и `OTP_DEV_MODE` в production не стартуют.
- Вход: лимит по IP, нарастающая блокировка по телефону (60 с → 1 ч), единый `401 invalid_credentials` и одна
  bcrypt-проверка на любую неудачу (фиктивный хеш для неизвестного номера).
- Токены staff принимаются только для существующего пользователя с `isActive=true`; хеш пароля не уходит в ответы.
- IP клиента: `trust proxy = loopback` в `main.ts`, nginx должен передавать `X-Forwarded-For`.
- Ошибки staff идут через глобальный `ErrorFilter`, он добавляет `code` и `retryAfter` (+ `Retry-After`).
- Владение данными: организация из `requireStaffOrganizationId(req)`; меню проверяется фрагментами из
  `product/services/menu-ownership.ts`; чужой id в пути или в теле → 404. Новые эндпоинты админки делай так же.

## Что нужно построить
- Статус публикации тенанта и флаги каналов (QR, доставка, режим: сайт, Mini App, оба). Публикация проверяет обязательное.
- Интерфейс провайдера доставки (создать, отменить, статус, вебхук) и адаптер собственных курьеров; внешние сервисы
  (Noor, Yandex, Millennium) по мере доступа к API.
- Уведомления о заказах через бота ресторана (сейчас платформенный бот из env).
- История старых slug с редиректом. Вторая цель в `revalidate-queue` для клиента доставки (с id тенанта и старым и
  новым slug); сейчас ревалидация идёт только в QR (`NEXT_PUBLIC_URL`, после переезда `https://qr.xmenu.uz`).
- Роли сотрудников для отдельного приложения (курьеры, официанты, менеджеры). Таблица `employee` есть, не используется.
- Позже: POS, Web Push/WebSocket для админки, фискальные чеки, промокоды (поле `discount` всегда 0), заказ ко
  времени, меню по филиалам, язык уведомлений клиенту (только русский), ротация `PAYMENT_CONFIG_KEY`, rate limit на
  `POST /orders`.

## Что не проверено (проверять на стенде перед опорой)
Запросы Prisma end-to-end (`POST /orders`), боевые вызовы Click/Payme (особенно reversal Click и параметры ссылки
Payme), Telegram webhook и кнопки, нагрузка. Стендов Click/Payme нет.

## Известные долги
- Ветки `feat/staff-auth-hardening` (21 коммит) и `fix/pilot-hardening` (7 коммитов поверх неё) не влиты в `main`.
- Refresh-токены staff без ротации и отзыва (выход не инвалидирует токен; удаление пользователя инвалидирует).
  Восстановления пароля для владельцев нет.
- Дашборд ещё на старом контракте регистрации (код `1111`, `?token=`): до его обновления регистрация в админке не
  работает. Что поменять: `docs/API.md`, «Авторизация владельцев».
- Загрузки (`MulterStorage`) принимают только изображения (JPEG, PNG, GIF, WebP по содержимому, до `UPLOAD_MAX_BYTES`) и
  пишут на диск после проверки. Но при 404 владельца в `PUT /organization`, `POST/PATCH /product…` файл, уже записанный
  валидатором, остаётся на диске без записи в БД. Файлы, загруженные до этой защиты, не проверялись: отдача делает
  любой не-образ `attachment` + `sandbox`, сами файлы не чистились.
- Ревалидация: ключ задания `revalidate-{route}-{slug|id}` (`docs/REVALIDATE.md`); бэкенд и QR расходятся по формату
  тела при смене slug (Q-01, чинится в QR). В `GET /application` читать могут только id из `PLATFORM_ADMIN_USER_IDS`.
- Группы допов, созданные до миграции `additional_product_group_organization` и не привязанные к блюду, без владельца
  (недоступны никому); можно удалить вручную.
- Кэш тенанта и настроек заказа в памяти процесса (30 с): после `PUT` настроек другие процессы pm2 видят старые
  язык, валюту и зону до 30 с.
- `ErrorFilter` (staff) отдаёт только `message`: тексты ошибок `ValidationPipe` (какое поле не прошло) в ответ
  админки не попадают.
- Скомпилированные `.js/.d.ts/.js.map` в `src/config` (не должны быть в репозитории).
- `npm run lint` не проходит (около 230 ошибок `recommendedTypeChecked`: нетипизированный `@Req() req`, `any` из
  конфигов и passport, код заказов и платежей), в CI lint не запускается. Для `*.spec.ts` и `*.fake.ts` правила
  `no-unsafe-*` и `require-await` выключены. На Windows с `core.autocrlf=true` prettier ругается на CRLF рабочей копии,
  хотя в git всё в LF: нужен `.gitattributes` с `eol=lf` или `endOfLine: 'auto'`.

## Правила
- Никаких захардкоженных кодов и секретов. Не логируй токены ботов, ключи провайдеров, OTP-коды.
- Вебхуки оплаты идемпотентны, подписи проверяются ключом именно этого тенанта.
- Любое изменение меню или slug вызывает ревалидацию QR (`revalidate-queue`, ключи заданий: `docs/REVALIDATE.md`).
- Новые эндпоинты с DTO и Swagger; изменение контракта обновляет `docs/*_API.md` в том же коммите.
- Новая бизнес-логика с тестами рядом (`*.spec.ts`). Тестовые подставки называй `*.fake.ts` (не попадают в сборку).
