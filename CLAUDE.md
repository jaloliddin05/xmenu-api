# xmenu-backend: единый API (api.xmenu.uz)

Общий контекст, решения и очередь задач: `../CLAUDE.md`. Обслуживает админку, QR-меню и клиентский фронт доставки.
Стадия: разработка и тестирование MVP; прода, клиентов и реальных данных нет, обратная совместимость не нужна.

## Стек
NestJS 11, TypeScript, Prisma 6 + PostgreSQL 16, Redis + BullMQ, Passport (JWT), class-validator,
Swagger (`/docs`), Jest. Prettier: одинарные кавычки, trailing comma `all`, отступ 2 пробела, с `;`.
Комментарии частично на узбекском, документация на русском; новые комментарии на английском.

## Команды
`npm run start:dev` · `npm run build` · `npm run lint` (только отчёт) · `npm run lint:fix` · `npm test` ·
`npm run test:e2e` · `npm run openapi`
(`openapi` собирает проект и пишет `docs/openapi.json` из сборки, без БД и Redis; `docs/API.md` правится руками).
Миграции: `npm run migrate` (собирает схему и запускает `prisma migrate dev`), на сервере `npx prisma migrate deploy`.
`generate-schema` вызывает `cat`: под Windows (npm запускает скрипты через cmd) он падает и оставляет
`prisma/schema.prisma` пустым. Собирай схему из Git Bash (`cat ./src/modules/*/*/*.prisma > prisma/schema.prisma`);
порядок файлов в glob там другой, поэтому лишние перестановки моделей в диффе лучше не коммитить.
Env: см. `.env.example` (полный). Ключевые: `JWT_*`, `OTP_*`, `SMS_PROVIDER`, `PAYMENT_CONFIG_KEY`, `REDIS_URL`, `PUBLIC_API_URL`, `PUBLIC_FILES_URL`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ORDERS_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_VERIFY_TTL_SECONDS`, `OPS_CHAT_ID`, `ORDER_QUEUES`,
`MINIAPP_URL`, `UPLOAD_MAX_BYTES`, `PLATFORM_ADMIN_USER_IDS`, `TRANSLATION_*`, `OPENAI_API_KEY` (необязателен: без него
`/translation` → 503 `translation_unavailable`), `NEXT_PUBLIC_URL` + `REVALIDATE_SECRET` (QR),
`CLIENT_REVALIDATE_URL` + `CLIENT_REVALIDATE_SECRET` (сайт доставки), `DELIVERY_URL_TEMPLATE` (адрес Mini App для кнопки бота), `STAFF_REFRESH_TTL_DAYS`,
`STAFF_SESSION_ABSOLUTE_DAYS`, `PUBLIC_POST_RATE_*`, `APPLICATION_RATE_*`, `TRANSLATION_IP_RATE_*` (лимиты по IP). Окончания строк LF (`.gitattributes`, `.editorconfig`).

## Схема Prisma
Не правь `prisma/schema.prisma` руками: он собирается из `src/modules/*/models/*.prisma` командой
`npm run generate-schema`. Меняй модельные файлы, потом `npm run migrate`.

## Модули
`auth` (два контура: staff и customer), `tenant` (`TenantGuard`, `TenantService`: тенант по id; `GET /tenant/by-slug`,
`GET /tenant/config` в `TenantConfigModule`), `organization` (+ настройки заведения), `user`, `employee` (пока не
используется), `branch`, `category`, `product` (+ группы допов), `menu` (публичный), `customer` (+ адреса),
`order` (state machine, очереди, уведомления), `payment` (Click, Payme, ключи тенанта, возвраты),
`sms` (провайдеры eskiz, telegram, console), `telegram` (боты заведений: `TelegramBotService`, `TelegramClient`,
`/telegram-bot`), `file`, `translation`, `application`,
`revalidate-queue` (`RevalidateModule`: ревалидация QR-меню и сайта доставки, `docs/REVALIDATE.md`).

## Контракт API
Единое место: `docs/API.md` и `docs/openapi.json`. Подробности: `docs/ORDERS_API.md`, `docs/BRANCHES_API.md`,
`docs/BACKEND_ORDERS.md`, `docs/TELEGRAM_VERIFICATION.md`. Меняешь контроллер или DTO: добавь `@ApiProperty` и
`@ApiOperation`, запусти `npm run openapi`, закоммить результат вместе с кодом. `.github/workflows/ci.yml` (build,
test, `npm run openapi` + `git diff --exit-code docs/`, lint без блокировки) проверяет это на PR; на GitHub ещё не
запускался, `deploy.yml` отдельный и без проверок.

## Тенантность
- Тенант только по `organization.id` (UUID, не меняется): `parseTenantId` (`tenant/tenant-key.ts`), `TenantService.resolve`
  (кэш 30 с, `invalidate(id)`), `TenantGuard` по `X-Tenant-Id`. Slug в заголовке → `tenant_not_found` без запроса в БД.
  Запасного пути по slug нет. Вебхуки оплаты по id: `payments/click/:tenantId`, `payments/payme/:tenantId`.
- `GET /tenant/by-slug/:slug` → `{ id, slug }` (только активные). `GET /tenant/config` → публичный конфиг
  (`tenant-config.service.ts`): незаполненное `null`, `delivery` в режимах только при заданной зоне.
- Кэш тенанта (30 с, в памяти процесса) сбрасывают `PUT /organization/:id/settings`, `PUT` и `DELETE
  /organization/:id`; кэш настроек заказа сбрасывает `PUT /order-settings`. Другие процессы pm2 видят старое до 30 с.
- Публичные ответы только через маппер или DTO со списком полей, не строкой БД: `GET /organization/slug/:slug` →
  `toPublicOrganization` (`organization/domain/public-organization.ts`, только активные), `toStaffUser` для
  владельца. Новый публичный эндпоинт делай так же.
- Slug: `organization/domain/slug.ts` (`slugify`: кириллица ru/uz транслитерируется, случайный `venue-xxxxxx` только если
  годного slug не вышло; 3–63 символа, `a-z0-9` и дефисы, не UUID, не из `RESERVED_SLUGS`: slug становится поддоменом `{slug}.xmenu.uz`), дубликат → 409 `slug_taken`.
- `Tenant` несёт `defaultLanguage`, `languages`, `currency` из `organization_settings`: язык ответа
  `resolveLang(req, tenant)`, запасной язык перевода `pickTranslation(list, lang, tenant.defaultLanguage)`, валюта
  меню, `/checkout-config` и заказа из настроек. Константы `'ru'` и `'UZS'` в коде ответов не используются.
- Тенант и клиент берутся из токена и заголовка, не из тела запроса. Каждый запрос и выборка привязаны к тенанту.
- Платёжные ключи и токены ботов шифруются AES-256-GCM (`PAYMENT_CONFIG_KEY`). Потеря ключа: все вводят заново.

## Настройки заведения
- `organization_settings` (бренд, валюта, языки, контакты, карта) и `organization_order_settings` (сбор, минимумы,
  ETA, тайм-ауты, зона): по одной строке на заведение, обе создаются в `OrganizationService.create` при регистрации
  значениями из `organization/domain/platform-defaults.ts`. У колонок нет `DEFAULT` в БД.
- Чтение не подставляет значения: нет строки → `settings_missing` (500) с логом. Исключение — тема:
  `PLATFORM_THEME` (`platform-defaults.ts`, 9 нейтральных цветов) и `resolveTheme()` дают полную `theme` в
  `GET /tenant/config` и `effectiveTheme` в ответах `GET/PUT /organization/:id/settings` (хранимая `theme` не меняется).
- Владелец: `GET/PUT /organization/:id/settings` (PUT заменяет документ целиком, проверки в
  `organization/domain/organization-settings.ts` и DTO), `GET/PUT /order-settings`.
- Нет зоны доставки (`delivery_zone = null`) → доставка недоступна: `POST /orders` отвечает
  `422 delivery_unavailable_no_zone`.
- Ошибки валидации: глобальный пайп `createValidationPipe()` (`infra/validators/validation-errors.ts`) отдаёт
  `400 validation_error` со списком `errors: [{ field, reason, message }]`; доменные проверки настроек тем же списком
  с кодом `invalid_settings` (`fieldErrorsException`). `ErrorFilter` (staff) всегда ставит `code` (иначе по
  статусу), пробрасывает `errors` и `details`, логирует только 5xx (без стектрейсов 4xx).

## Каналы и публикация
Контракт: `docs/API.md`, «Каналы и публикация». Код: `organization/domain/publication.ts` (чеклист, `orderingProblem`),
`PublicationService`, `OrganizationPublicationController`.
- Поля в `organization`: `qr_enabled` (по умолчанию `true`), `delivery_enabled` (`false`; канал заказов: сайт и/или Mini
  App, доставка и самовывоз), `delivery_mode` (`site` | `miniapp` | `both`, по умолчанию `site`), `published_at`.
  У колонок есть `DEFAULT` в БД (миграция на непустой БД), новое заведение получает `PLATFORM_CHANNELS` явно.
- Заказы открыты при `delivery_enabled && published_at`. Выключение канала обнуляет `published_at`; `miniapp` и `both`
  требуют подключённого включённого бота (`422 telegram_bot_required`).
- `POST /publish` проверяет чеклист (`409 publication_incomplete`, `details.missing`); уже опубликованное отвечает 200
  без проверки. Запись в транзакции с `SELECT … FOR UPDATE` строки организации, `published_at` ставится условным
  `updateMany`. Правки меню, филиалов и зоны эту блокировку не берут: опубликованное может стать неготовым, публикация
  не снимается.
- `POST /orders` читает состояние из БД (не из кэша тенанта): `422 ordering_channel_disabled` / `ordering_not_published`.
  `GET /tenant/config` отдаёт `channels`, `fulfillment.modes` пуст без публикации. `channels.qr` бэкенд не применяет
  (меню отдаётся), его читает QR-фронт.
- Изменения ставят ревалидацию с `route: 'channels'` (QR и клиент).
- Бот удалён (`DELETE /telegram-bot`) при режиме `miniapp`/`both`: режим остаётся, пункт `telegram_bot` в чеклисте
  становится `todo`, публикация не снимается.

## Филиалы
- Часы считает `branch/domain/branch-hours.ts` (одна функция для `GET /branches` и `POST /orders`). Филиал без
  расписания закрыт: `isOpen: false`, `opensAt: null`, заказ → `422 branch_hours_not_set`. Круглосуточно: `is24h`
  на всех семи днях. Выбор филиала для заказа: `order/domain/branch-choice.ts`.

## Заказы
`OrderTransitionService` единственный путь смены статуса (автомат, optimistic locking по `version`, журнал).
Оплату подтверждает только вебхук провайдера. Эскалация: 45 с повтор в Telegram, 120 с SMS, 300 с авто-отмена и
возврат. Робозвонка в цепочке нет: задачи `esc-call`, оставшиеся в Redis, молча пропускаются. Click возвращает автоматически,
Payme вручную через ops-чат.

## Авторизация клиентов
Телефон + OTP (HMAC-хеш кода, TTL, лимит попыток, cooldown) через `SmsProvider`; refresh-токены с ротацией и
сессиями. `CustomerOtpService.issue()` не зависит от канала доставки (SMS или Telegram), лимиты по телефону общие.
Целевые параметры: `OTP_LENGTH=6`, `OTP_TTL_SECONDS=300`, `OTP_MAX_ATTEMPTS=5`, `OTP_COOLDOWN_SECONDS=60`
По умолчанию 6, длина приходит в `codeLength`; дашборд её читает, клиент доставки пока ждёт 4.
`TelegramInitDataService.verifyForTenant` проверяет `initData` токеном бота заведения (иначе платформенным
`TELEGRAM_BOT_TOKEN`) и входом не является.

## Боты заведений и подтверждение номера через Telegram
Контракт и сценарии: `docs/TELEGRAM_VERIFICATION.md`. На реальном Telegram не проверено (чек-лист там же).
- `TelegramBotService` (`modules/telegram`): `GET/PUT/DELETE /telegram-bot` из админки. Таблица
  `organization_telegram_bot` (одна строка на заведение, `telegram_bot_id` уникален), токен зашифрован
  `PAYMENT_CONFIG_KEY`, `PUT` требует https `PUBLIC_API_URL`. Webhook `POST /telegram/bot/:botKey/webhook`
  (`botKey` = id строки, не slug), секрет в заголовке сравнивается за константное время. `TelegramClient` не
  кладёт токен в ошибки: логируй через `telegramErrorText(e)`.
- `TelegramBotProfileService` (`modules/telegram`): автонастройка бота заведения (имя, описания, `/start`, кнопка меню Mini App) по
  профилю из `organization_telegram_bot.profile` или дефолтам из данных заведения (`domain/bot-profile.ts`); `PUT
  /telegram-bot` применяет её после подключения, `PUT /telegram-bot/profile` и `POST /telegram-bot/sync` вручную, смена slug
  перенастраивает кнопку. Пункты независимы, итог в `sync_result`. Аватар не меняется (нет метода). На реальном Telegram не проверено.
- `TelegramVerificationService` + `TelegramBotWebhookController` (в `auth`), клиентские `POST
  /auth/customer/telegram/start` и `/status`. Режимы: Mini App (`instant`, сессия привязана к Telegram-пользователю
  из `initData`, вход выдаётся в `status` один раз) и сайт (`code`, код приходит в чат только при совпадении номера,
  дальше обычный `otp/verify`). Сессии в Redis (`tgv:*`, `TELEGRAM_VERIFY_TTL_SECONDS`). Контакт принимается только
  если `contact.user_id == from.id`.
- Код из бота выдаёт `CustomerOtpService.issue()` (тот же хеш, попытки и лимиты по телефону, что у SMS).
- Вход завершает `CustomerAuthService.completeVerifiedPhone` (общий для SMS и Telegram).
- Уведомления о заказах по-прежнему идут через платформенного бота (`telegram-orders.controller.ts`).

## Авторизация владельцев (staff)
Контракт, ошибки и лимиты: `docs/API.md`. Код: `StaffAuthService` (регистрация и вход),
`StaffSessionService` (сессии), `StaffLoginThrottleService` (блокировка), `StaffAuthEventService` (аудит в
`staff_auth_event`).
- Сессии: access JWT (`JWT_ACCESS_TOKEN_*`) и непрозрачный refresh-токен, хеш в `staff_session` (модель в
  `user/models/staff-session.prisma`). `POST /auth/refresh { refreshToken }` ротирует (повтор после 30 с отзывает
  вход), `POST /auth/logout { refreshToken }` → 204 отзывает вход. Access живёт до своего срока (1 ч).
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
- Интерфейс провайдера доставки (создать, отменить, статус, вебхук) и адаптер собственных курьеров; внешние сервисы
  (Noor, Yandex, Millennium) по мере доступа к API.
- Уведомления о заказах через бота ресторана (сейчас платформенный бот из env).
- История старых slug с редиректом.
- Возврат после оплаты на сайт заведения: сейчас `MINIAPP_RETURN_URL`/`MINIAPP_URL` один на платформу
  (`payment/domain/payment-url.ts`), а не `https://{slug}.xmenu.uz`. Бэкенд адресов `{slug}.xmenu.uz` нигде не строит:
  slug только валидируется как поддомен (`organization/domain/slug.ts`).
- Отзыв всех сессий владельца при смене пароля, восстановление пароля, выход «везде».
- Роли сотрудников для отдельного приложения (курьеры, официанты, менеджеры). Таблица `employee` есть, не используется.
- Позже: POS, Web Push/WebSocket для админки, фискальные чеки, промокоды (поле `discount` всегда 0), заказ ко
  времени, меню по филиалам, язык уведомлений клиенту (только русский), ротация `PAYMENT_CONFIG_KEY`, rate limit на
  `POST /orders`.

## Что не проверено (проверять на стенде перед опорой)
Запросы Prisma end-to-end (`POST /orders`), боевые вызовы Click/Payme (особенно reversal Click и параметры ссылки
Payme), Telegram webhook и кнопки, боты заведений (`PUT /telegram-bot`, вебхук, `requestContact()` в Mini App,
цепочка `deepLink` → контакт → код → `otp/verify`), нагрузка. Стендов Click/Payme нет.

## Известные долги
- Ветки `feat/staff-auth-hardening`, `fix/pilot-hardening`, `feat/tenant-config`, `feat/reserved-slugs` влиты в `main`
  (2026-10-29, fast-forward, без PR); `npm test` и `npm run build` проходили, миграции на реальной БД не применялись.
- Сессии владельцев: ротация и выход есть, но смена пароля сессии не отзывает, access-токен после выхода живёт до
  часа (denylist нет), восстановления пароля нет. Дашборд должен перейти на `POST /auth/refresh` с телом и
  сохранять новый refresh-токен, иначе после первого обновления токена его выкинет на вход.
- Загрузки (`MulterStorage`) принимают только изображения (JPEG, PNG, GIF, WebP по содержимому, до `UPLOAD_MAX_BYTES`) и
  пишут на диск после проверки. Но при 404 владельца в `PUT /organization`, `POST/PATCH /product…` файл, уже записанный
  валидатором, остаётся на диске без записи в БД. Файлы, загруженные до этой защиты, не проверялись: отдача делает
  любой не-образ `attachment` + `sandbox`, сами файлы не чистились.
- Ревалидация: ключ задания `revalidate-{target}-{route}-{tenantId}`, цели QR и сайт доставки (`docs/REVALIDATE.md`);
  в очередь идут tenantId, route, oldSlug, актуальный slug читается при выполнении; при заданном адресе цели и пустом
  секрете production не стартует (`revalidate-config.ts`); без `CLIENT_REVALIDATE_URL` задания клиенту не ставятся. В
  `GET /application` читать могут только id из `PLATFORM_ADMIN_USER_IDS`.
- Группы допов, созданные до миграции `additional_product_group_organization` и не привязанные к блюду, без владельца
  (недоступны никому); можно удалить вручную.
- Кэш тенанта и настроек заказа в памяти процесса (30 с): после `PUT` другие процессы pm2 видят старые имя, slug,
  язык, валюту и зону до 30 с. `is_active` через API не меняется (только в БД), сброса для него нет.
- `GET /organization/slug/:slug` ещё открыт: закрыть, когда QR перейдёт на `by-slug` + `tenant/config` (Q2).
- `npm run lint` (без `--fix`) не проходит (около 230 ошибок `recommendedTypeChecked` в старом коде:
  нетипизированный `@Req() req`, `any` из конфигов и passport, код заказов и платежей), в CI lint запускается без блокировки (отчёт).
  Новые файлы проходят. Для `*.spec.ts` и `*.fake.ts` правила `no-unsafe-*` и `require-await` выключены.
  `.gitattributes` (`eol=lf`) добавлен; рабочая копия, выгруженная раньше с `core.autocrlf=true`, остаётся в CRLF,
  пока файлы не перевыгрузить (`git rm --cached -r . && git reset --hard` на чистом дереве).

## Лимиты публичных POST
`PublicRateLimitGuard` (`infra/http/public-rate-limit.ts`, глобальный `APP_GUARD`): POST к `@Public()` маршрутам по IP через
`RateLimitService`; `@PublicRateLimit` добавляет строже (`/application`), `@SkipPublicRateLimit` снимает (вебхуки Click,
Payme, Telegram). Новый публичный POST с `@Public()` попадает под общий лимит сам; вебхук провайдера пометь Skip.
CORS `origin: true` оставлен осознанно, обоснование в `docs/API.md`.

## Правила
- Никаких захардкоженных кодов и секретов. Не логируй токены ботов, ключи провайдеров, OTP-коды.
- Вебхуки оплаты идемпотентны, подписи проверяются ключом именно этого тенанта.
- Любое изменение меню или slug вызывает ревалидацию QR (`revalidate-queue`, ключи заданий: `docs/REVALIDATE.md`).
- Новые эндпоинты с DTO и Swagger; изменение контракта обновляет `docs/*_API.md` в том же коммите.
- Новая бизнес-логика с тестами рядом (`*.spec.ts`). Тестовые подставки называй `*.fake.ts` (не попадают в сборку).
