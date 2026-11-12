# xmenu-backend: единый API (api.xmenu.uz)

Общий контекст, решения и очередь задач: `../CLAUDE.md`. Обслуживает админку, QR-меню и клиентский фронт доставки.
Стадия: разработка и тестирование MVP; прода, клиентов и реальных данных нет, обратная совместимость не нужна.

## Стек
NestJS 11, TypeScript, Prisma 6 + PostgreSQL 16, Redis + BullMQ, Passport (JWT), class-validator,
Swagger (`/docs`), Jest. Prettier: одинарные кавычки, trailing comma `all`, отступ 2 пробела, с `;`.
Комментарии частично на узбекском, документация на русском; новые комментарии на английском.

## Команды
`npm run start:dev` · `npm run build` · `npm run lint` · `npm run format:check` · `npm run format` · `npm run lint:fix` · `npm test` ·
`npm run test:e2e` · `npm run openapi` · `npm run check:env` · `npm run check:user-texts`
(`openapi` собирает проект и пишет `docs/openapi.json` и `docs/ERRORS.md` из сборки, без БД и Redis; `docs/API.md` правится руками;
`check:env` проверяет `.env` той же схемой, что старт, `-- --production` как production; `check:user-texts` см. «Ошибки»).
Миграции: `npm run migrate` (собирает схему и запускает `prisma migrate dev`), на сервере `npx prisma migrate deploy`.
`generate-schema` вызывает `cat`: под Windows (npm запускает скрипты через cmd) он падает и оставляет
`prisma/schema.prisma` пустым. Собирай схему из Git Bash (`cat ./src/modules/*/*/*.prisma > prisma/schema.prisma`);
порядок файлов в glob там другой, поэтому лишние перестановки моделей в диффе лучше не коммитить.
Env: см. `.env.example` (полный; тест сверяет его со схемой и со всеми `process.env` в коде). Схема и проверка при
старте: `src/config/env/env-schema.ts` (`ENV_SCHEMA`: тип, обязательность, https в production; перекрёстные правила
лежат рядом с кодом, который их использует, функциями `*EnvIssues`, `validateEnv` их собирает; вызов в `main.ts` до
создания приложения). Production при любой ошибке не стартует; development останавливают только неразбираемые
значения и отсутствие секретов клиента, остальное печатается сводкой «функция выключена: причина» (`featureStatus`).
Новую переменную добавляй в схему и `.env.example`. Ключевые: `JWT_*`, `OTP_*`, `SMS_PROVIDER`, `PAYMENT_CONFIG_KEY`, `REDIS_URL`, `PUBLIC_API_URL`, `PUBLIC_FILES_URL`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ORDERS_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_VERIFY_TTL_SECONDS`,
`TELEGRAM_API_BASE_URL` (база всех вызовов Bot API, `infra/telegram/telegram-api-url.ts`; фейк в тестах и e2e, в production только
`https://api.telegram.org`), `OPS_CHAT_ID`, `ORDER_QUEUES`,
`MINIAPP_URL`, `UPLOAD_MAX_BYTES`, `PLATFORM_ADMIN_USER_IDS`, `TRANSLATION_*`, `OPENAI_API_KEY` (необязателен: без него
`/translation` → `503 platform_misconfigured`, `feature: translation`), `NEXT_PUBLIC_URL` + `REVALIDATE_SECRET` (QR),
`CLIENT_REVALIDATE_URL` + `CLIENT_REVALIDATE_SECRET` (сайт доставки), `DELIVERY_URL_TEMPLATE` (адрес Mini App для кнопки бота),
`PLATFORM_DOMAIN` (`xmenu.uz`; в dev `localhost`), `DOMAIN_VERIFY_SKIP` (только dev), `DOMAIN_VERIFY_DNS_SERVERS` (DNS проверки доменов, фейк в e2e), `STAFF_REFRESH_TTL_DAYS`,
`STAFF_SESSION_ABSOLUTE_DAYS`, `PUBLIC_POST_RATE_*`, `APPLICATION_RATE_*`, `TRANSLATION_IP_RATE_*` (лимиты по IP). Окончания строк LF (`.gitattributes`, `.editorconfig`).

## Схема Prisma
Не правь `prisma/schema.prisma` руками: он собирается из `src/modules/*/models/*.prisma` командой
`npm run generate-schema`. Меняй модельные файлы, потом `npm run migrate`.

## Модули
`auth` (два контура: staff и customer), `tenant` (`TenantGuard`, `TenantService`: тенант по id; `GET /tenant/by-slug`,
`GET /tenant/config` в `TenantConfigModule`), `organization` (+ настройки заведения), `user`, `employee` (не
используется), `branch`, `category`, `product` (+ группы допов), `menu` (публичный), `customer` (+ адреса),
`order` (state machine, очереди, уведомления), `payment` (Click, Payme, ключи тенанта, возвраты),
`sms` (провайдеры eskiz, telegram, console), `telegram` (боты заведений: `TelegramBotService`, `TelegramClient`,
`/telegram-bot`), `tenant-domain` (свои домены заведения, `/organization/:id/domains`), `file`, `translation`, `application`,
`revalidate-queue` (`RevalidateModule`: ревалидация QR-меню и сайта доставки, `docs/REVALIDATE.md`), `guest-login` (способы входа
клиентов заведения: `GuestLoginService`).

## Контракт API
Единое место: `docs/API.md` и `docs/openapi.json`. Подробности: `docs/ORDERS_API.md`, `docs/BRANCHES_API.md`,
`docs/BACKEND_ORDERS.md`, `docs/TELEGRAM_VERIFICATION.md`. Меняешь контроллер или DTO: добавь `@ApiProperty` и
`@ApiOperation`, запусти `npm run openapi`, закоммить результат вместе с кодом. `.github/workflows/ci.yml` (build,
test, `npm run openapi` + `git diff --exit-code docs/`, `format:check`, `lint` и `check:user-texts` блокирующие) проверяет это на PR. Шаги: чистая БД `migrate deploy`, `migrate diff` без расхождений, `scripts/check-migration-upgrade.sh`, build, test, openapi); `deploy.yml` отдельный и без проверок, запускается только вручную (`workflow_dispatch`), см. «Деплой».
Локально те же шаги: временные БД (`createdb xmenu_ci`, `xmenu_ci_shadow`, `xmenu_upgrade`), `DATABASE_URL=… npx prisma migrate deploy`, `npx prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel prisma/schema.prisma --exit-code`, `DATABASE_URL=<пустая БД> scripts/check-migration-upgrade.sh`, затем `npm run build`, `npm test`, `npm run openapi && git diff --exit-code docs/`. В Windows psql принимает URL только через `--dbname=`.

## Тенантность
- Тенант только по `organization.id` (UUID, не меняется): `parseTenantId` (`tenant/tenant-key.ts`), `TenantService.resolve`
  (кэш 30 с, `invalidate(id)`), `TenantGuard` по `X-Tenant-Id`. Slug в заголовке → `tenant_not_found` без запроса в БД.
  Запасного пути по slug нет. Вебхуки оплаты по id: `payments/click/:tenantId`, `payments/payme/:tenantId`.
- `GET /tenant/by-slug/:slug` → `{ id, slug }` (только активные). `GET /tenant/config` → публичный конфиг
  (`tenant-config.service.ts`): незаполненное `null`, `delivery` в режимах только при заданной зоне.
- `GET /tenant/by-host/:host` → `{ id, slug, name, primaryDomain }` (`TenantService.findActiveByHost`): хост
  нормализуется (`tenant/host.ts`: регистр, порт, точка в конце, IDN → punycode); `{slug}.{PLATFORM_DOMAIN}` ровно с
  одной меткой разбирается по slug без таблицы, любой другой хост только через подтверждённый `tenant_domain`
  (`verified_host`). Заголовки `Host`/`X-Forwarded-Host` запроса тенантом не считаются нигде.
- Свои домены (`modules/tenant-domain`, контракт `docs/API.md`, «Домены заведения»): таблица `tenant_domain`
  (`host` канонический, `status` `pending`/`verified`, `verified_host` уникален и задан только у подтверждённого,
  `@@unique([organization_id, host])`; неподтверждённый хост может быть у нескольких заведений, каждое со своим
  токеном). Добавление в транзакции с `FOR UPDATE` строки организации (лимит 5). Проверка владения за интерфейсом
  `DomainOwnershipVerifier` (`DOMAIN_VERIFIER`): `DnsTxtVerifier` (TXT `_xmenu-verify.<host>` =
  `xmenu-verify=<token>`; резолверы системные или `DOMAIN_VERIFY_DNS_SERVERS`, так e2e подставляют фейковый DNS),
  `SkipDomainVerifier` при `DOMAIN_VERIFY_SKIP=true`, в тестах `FakeDomainVerifier` и UDP-сервер `dns-server.fake.ts`.
  `domainEnvIssues` (проверка при старте): production не стартует с флагом и без годного `PLATFORM_DOMAIN`; фабрика
  верификатора флагу в production не верит. Без `PLATFORM_DOMAIN` (development) добавление домена → `503 platform_misconfigured`.
  `primaryDomain` = самый ранний подтверждённый (`tenant/primary-domain.ts`, один select для всех ответов).
  Подтверждение и удаление подтверждённого: `TenantService.invalidate` + ревалидация `route: 'domains'` с `host`.
  Новый платформенный поддомен по-прежнему надо добавить в `RESERVED_SLUGS`; свои домены под `PLATFORM_DOMAIN`
  запрещены целиком.
- Кэш тенанта (30 с, в памяти процесса) сбрасывают `PUT /organization/:id/settings`, `PUT` и `DELETE
  /organization/:id`; кэш настроек заказа сбрасывает `PUT /order-settings`. Другие процессы pm2 видят старое до 30 с.
- Публичные ответы только через маппер или DTO со списком полей, не строкой БД: `GET /tenant/config`, `GET /menu`
  собираются мапперами и DTO, `toStaffUser` для владельца. Новый публичный эндпоинт делай так же.
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
  `GET /tenant/config` и `effectiveTheme` и `platformTheme` (чистые цвета платформы) в ответах `GET/PUT /organization/:id/settings` (хранимая `theme` не меняется).
- Владелец: `GET/PUT /organization/:id/settings` (PUT заменяет документ целиком, проверки в
  `organization/domain/organization-settings.ts` и DTO), `GET/PUT /order-settings`.
- Нет зоны доставки (`delivery_zone = null`) → доставка недоступна: `POST /orders` отвечает
  `422 delivery_unavailable_no_zone`.
- Ошибки валидации: глобальный пайп `createValidationPipe()` (`infra/validators/validation-errors.ts`) отдаёт
  `400 validation_error` со списком `fields: [{ field, code, message }]` (`code` правило в snake_case, `fieldCode`);
  доменные проверки настроек тем же списком с кодом `invalid_settings` (`fieldErrorsException`), одиночное поле вне
  class-validator: `fieldError(field, code, message)`. Общий контракт ошибок: раздел «Ошибки».

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
- Изменения ставят ревалидацию с `route: 'channels'` (QR и клиент); её ставит и `TelegramBotService` при подключении и
  отключении бота. Способы входа клиентов `{ sms, telegram }` считает `GuestLoginService` (`modules/guest-login`):
  `telegram` = `TelegramBotService.usable` (бот включён и токен расшифровывается), `sms` = `smsLoginAvailable()`
  (`isSmsConfigured()` из `sms.module.ts` или `OTP_DEV_MODE`, как решает `otp/request`; проверка настроек, не пинг).
  Отдаются в `channels.auth` `GET /tenant/config` (кэшируется) и в `GET /auth/customer/methods` (`no-store`, для шторки
  входа); источник истины остаются `otp/request` и `telegram/start`. Опубликованное заведение с включённым каналом без
  единого способа: `warn` в лог и ops-чат (`OpsNotifierService`), не чаще раза в час на заведение (Redis `SET NX EX`).
- `GET /publication` и остальные ответы публикации несут `warnings` (`guestLoginWarnings` в `publication.ts`:
  `guest_login_telegram_only`, `guest_login_unavailable`), отдельно от чеклиста; публикацию они не блокируют.
- Бот удалён (`DELETE /telegram-bot`) при режиме `miniapp`/`both`: режим остаётся, пункт `telegram_bot` в чеклисте
  становится `todo`, публикация не снимается; вход гостя и заказ в этих режимах отвечают `503 telegram_unavailable`.
- Режим доставки применяется к шагам входа гостя (`otp/request`, `otp/verify`, `register`, `telegram/start`, `login`) и
  к `POST /orders`: `MiniAppAccessService` (`auth/services/mini-app-access.service.ts`, модуль `MiniAppModule`, его
  импортирует и `OrderModule`), правило `deliveryModeProblem` (`organization/domain/delivery-mode.ts`). Заголовок
  `X-Telegram-Init-Data` проверяется только токеном бота заведения и сроком `TELEGRAM_INITDATA_MAX_AGE_SECONDS`:
  `site` его не смотрит, `miniapp` требует (`403 miniapp_required`), неверный в `miniapp`/`both` → `403
  miniapp_init_data_invalid`. В `POST /orders` после канала и публикации, режим читается из БД тем же select.
  `GET /tenant/config`: `channels.delivery.miniApp` (режим не `site` и бот `usable`) и `botUsername` (только при `miniApp`).

## Филиалы
- Часы считает `branch/domain/branch-hours.ts` (одна функция для `GET /branches` и `POST /orders`). Филиал без
  расписания закрыт: `isOpen: false`, `opensAt: null`, заказ → `422 branch_hours_not_set`. `GET /branches` и `details.opensAt` у `branch_closed` отдают `opensAt` как ISO
  8601 с датой и поясом филиала (`opensAtIso`); при доставке ближайшее открытие выбирается по моменту времени. Круглосуточно: `is24h`
  на всех семи днях. Выбор филиала для заказа: `order/domain/branch-choice.ts`.

## Заказы
`OrderTransitionService` единственный путь смены статуса (автомат, optimistic locking по `version`, журнал).
Оплату подтверждает только вебхук провайдера. Эскалация: 45 с повтор в Telegram, 120 с SMS, 300 с авто-отмена и
возврат. Робозвонка в цепочке нет: задачи `esc-call`, оставшиеся в Redis, молча пропускаются. Click возвращает автоматически,
Payme вручную через ops-чат.

## Авторизация клиентов
Телефон + OTP (HMAC-хеш кода, TTL, лимит попыток, cooldown) через `SmsProvider`; refresh-токены с ротацией и
сессиями. `CustomerOtpService.issue()` не зависит от канала доставки (SMS или Telegram), лимиты по телефону общие.
Параметры и значения по умолчанию: `OTP_LENGTH`, `OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS`, `OTP_COOLDOWN_SECONDS` (см. `.env.example`).
Длина кода приходит в `codeLength`; фронты читают её из ответа, своих констант у них нет.
`TelegramInitDataService.verifyForTenant` проверяет `initData` из тела токеном бота заведения (иначе платформенным
`TELEGRAM_BOT_TOKEN`); заголовок `X-Telegram-Init-Data` проверяет `MiniAppAccessService` только ботом заведения.
Вход по `initData` (`POST /auth/customer/login`) только для клиента с уже привязанным `telegram_id`. Подтверждение в Mini
App (`instant`) нового номера кладёт Telegram-id в `registrationToken` (`tg`), `register` его привязывает.

Язык клиента: `customer.language` (`ru|uz|en`, null до первого входа), задаётся из языка запроса (`RequestCtx.lang`,
`resolveLang`) при регистрации и первом входе, меняется `PATCH /customers/me`. SMS-коды берут язык запроса
(`SMS_TEXT` в `customer-otp.service.ts`), уведомления клиенту `customerLangFor` (язык клиента, если заведение его
предлагает, иначе язык заведения) и `CUSTOMER_TEXTS` (`order/notifications/customer-messages.ts`).

## Боты заведений и подтверждение номера через Telegram
Контракт и сценарии: `docs/TELEGRAM_VERIFICATION.md`.
- `TelegramBotService` (`modules/telegram`): `GET/PUT/DELETE /telegram-bot` из админки. Таблица
  `organization_telegram_bot` (одна строка на заведение, `telegram_bot_id` уникален), токен зашифрован
  `PAYMENT_CONFIG_KEY`, `PUT` требует https `PUBLIC_API_URL`. Webhook `POST /telegram/bot/:botKey/webhook`
  (`botKey` = id строки, не slug): в БД sha256 секрета (`webhook_secret_hash`, `domain/webhook-secret.ts`), заголовок
  хешируется и сравнивается за константное время. Вебхук после секрета и отметки `update_id` (`claimUpdate`) кладёт апдейт
  в очередь BullMQ `telegram-update` и сразу отвечает 200; обработка (`TelegramUpdateProcessor`, 3 попытки) идёт в фоне,
  сбой постановки в очередь → 503. `DELETE /telegram-bot` → 200 `{ connected: false, leftOnBot }`: имя, описания и
  команды остаются у бота (не сбрасываем), кнопка меню возвращается к стандартной. `TelegramClient` не
  кладёт токен в ошибки: логируй через `telegramErrorText(e)`. Токен, который не расшифровывается (сменён `PAYMENT_CONFIG_KEY`,
  повреждён), даёт `platform_misconfigured` (`telegram_bot`) с причиной в логе, а не 500; `DELETE` при этом работает. Адрес
  вебхука (с `botKey`) в ответы владельцу не попадает, только в лог при подключении.
- `TelegramBotProfileService` (`modules/telegram`): автонастройка бота заведения (имя, описания, `/start`, кнопка меню Mini App) по
  профилю из `organization_telegram_bot.profile` или дефолтам из данных заведения (`domain/bot-profile.ts`); `PUT
  /telegram-bot` применяет её после подключения, `PUT /telegram-bot/profile` и `POST /telegram-bot/sync` вручную. Кнопка меню
  и кнопка `/start` следуют режиму доставки (`miniAppUrl` в `domain/bot-profile.ts`: `site` → стандартная кнопка и `/start`
  без кнопки; иначе `https://<primaryDomain>` или `DELIVERY_URL_TEMPLATE`); `syncMenuButton` (не бросает, шлёт полное
  состояние) вызывают смена режима (`PublicationService.setChannels`), смена slug и `TenantDomainService` при
  подтверждении и удалении подтверждённого домена. Пункты независимы, итог в `sync_result`. Аватар не меняется (нет метода в Bot API).
- `TelegramVerificationService` + `TelegramBotWebhookController` (в `auth`), клиентские `POST
  /auth/customer/telegram/start` и `/status`. Режимы: Mini App (`instant`, сессия привязана к Telegram-пользователю
  из `initData`, вход выдаётся в `status` один раз) и сайт (`code`, код приходит в чат только при совпадении номера,
  дальше обычный `otp/verify`). Сессии в Redis (`tgv:*`, `TELEGRAM_VERIFY_TTL_SECONDS`). Контакт принимается только
  если `contact.user_id == from.id`.
- Код из бота выдаёт `CustomerOtpService.issue()` (тот же хеш, попытки и лимиты по телефону, что у SMS).
- Вход завершает `CustomerAuthService.completeVerifiedPhone` (общий для SMS и Telegram). `telegram/status` с `code_sent`
  отдаёт `codeLength` (`cfg.otpLength`, как `otp/request`).
- Уведомления о заказах по-прежнему идут через платформенного бота (`telegram-orders.controller.ts`).

## Авторизация владельцев (staff)
Контракт, ошибки и лимиты: `docs/API.md`. Код: `StaffAuthService` (регистрация и вход),
`StaffSessionService` (сессии), `StaffLoginThrottleService` (блокировка), `StaffAuthEventService` (аудит в
`staff_auth_event`).
- Сессии: access JWT (`JWT_ACCESS_TOKEN_*`) и непрозрачный refresh-токен, хеш в `staff_session` (модель в
  `user/models/staff-session.prisma`). `POST /auth/refresh { refreshToken }` ротирует (повтор после 30 с отзывает
  вход), `POST /auth/logout { refreshToken }` → 204 отзывает вход. Access-токен несёт `sid` (= `family_id` входа);
  завершённый вход попадает в Redis-денилист `staff:sid:revoked:<sid>` на срок жизни access, стратегия
  `AccessTokenUserStrategy` его проверяет, токен без `sid` не принимается. `req.user.sid` = текущий вход.
- Сессии (`StaffSessionsController`, `StaffSessionService`): `GET /auth/sessions` (устройство и браузер из User-Agent,
  `user-agent.ts`, IP с маской), `DELETE /auth/sessions/:id` (чужой → 404), `DELETE /auth/sessions` (все, кроме
  текущей), `revokeAllForUser`. Столбца «последняя активность» нет: берётся `created_at` текущей строки входа.
- Пароль (`StaffPasswordService`): `POST /auth/password/forgot` одинаков для известного и неизвестного номера (тот же
  `otp.issue` и лимиты, у неизвестного пустая доставка, SMS у известного уходит без ожидания), код привязан к номеру
  (`sotp:pwreset:<phone>`), `POST /auth/password/reset` отзывает все входы, `POST /auth/password/change` (текущий пароль,
  лимит попыток) отзывает все, кроме текущего. Старого `PUT /user/change-password/:id` нет. Тесты на единообразие
  ответа и отзыв сессий: `staff-password.service.spec.ts`.
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
- Владение данными: организация из `requireStaffOrganizationId(req)`; меню проверяется фрагментами из
  `product/services/menu-ownership.ts`; чужой id в пути или в теле → 404. Новые эндпоинты админки делай так же.

## Что нужно построить
- Интерфейс провайдера доставки (создать, отменить, статус, вебхук) и адаптер собственных курьеров; внешние сервисы
  (Noor, Yandex, Millennium) по мере доступа к API.
- Уведомления о заказах через бота ресторана (пока идут через платформенного бота из env).
- История старых slug с редиректом.
- Возврат после оплаты на сайт заведения: `MINIAPP_RETURN_URL`/`MINIAPP_URL` один на платформу
  (`payment/domain/payment-url.ts`), а не `https://{slug}.xmenu.uz`. Бэкенд адресов `{slug}.xmenu.uz` нигде не строит:
  slug только валидируется как поддомен (`organization/domain/slug.ts`).
- Роли сотрудников для отдельного приложения (курьеры, официанты, менеджеры). Таблица `employee` есть, не используется.
- Позже: POS, Web Push/WebSocket для админки, фискальные чеки, промокоды (поле `discount` всегда 0), заказ ко
  времени, меню по филиалам, ротация `PAYMENT_CONFIG_KEY`, rate limit на
  `POST /orders`.

## Известные долги
- Сессии владельцев: «последняя активность» в списке сессий = последний refresh (запросы между refresh не пишутся в БД).
- Загрузки (`MulterStorage`) принимают только изображения (JPEG, PNG, GIF, WebP по содержимому, до `UPLOAD_MAX_BYTES`) и
  пишут на диск после проверки. Но при 404 владельца в `PUT /organization`, `POST/PATCH /product…` файл, уже записанный
  валидатором, остаётся на диске без записи в БД.  Отдача делает любой не-образ `attachment` + `sandbox`.
- Ревалидация: ключ задания `revalidate-{target}-{route}-{tenantId}`, цели QR и сайт доставки (`docs/REVALIDATE.md`);
  в очередь идут tenantId, route, oldSlug, актуальный slug читается при выполнении; при заданном адресе цели и пустом
  секрете production не стартует (`revalidate-config.ts`); без `CLIENT_REVALIDATE_URL` задания клиенту не ставятся. В
  `GET /application` читать могут только id из `PLATFORM_ADMIN_USER_IDS`.
- Кэш тенанта и настроек заказа в памяти процесса (30 с): после `PUT` другие процессы pm2 видят старые имя, slug,
  язык, валюту и зону до 30 с. `is_active` через API не меняется (только в БД), сброса для него нет.
- Форматирование и линт блокируют CI (`npm run format:check`, `npm run lint`; должны проходить без ошибок и предупреждений).
  Prettier по `.prettierrc`, `npm run format` перед коммитом; `lint:fix` только для автоисправляемого. `eslint-disable` на
  весь файл не используем; строчные исключения только с причиной в комментарии. Послабления правил лежат в
  `eslint.config.mjs` с обоснованием (`no-explicit-any` выключен для старого кода; в `*.spec.ts`, `*.fake.ts` и `test/` выключены
  `no-unsafe-*`, `require-await`, `unbound-method`; аргументы с `_` в начале разрешены неиспользуемыми). Типы на границах
  (`@Req()` на маршрутах владельца: `StaffRequest` из `infra/http/request-helpers.ts`; `catch`: `errorMessage`/`errorStack` из
  `infra/helper/error-text.ts`) вместо `any`.
- Массовый коммит форматирования (`style: format with prettier`) записан в `.git-blame-ignore-revs`; чтобы `git blame`
  его пропускал: `git config blame.ignoreRevsFile .git-blame-ignore-revs` (GitHub читает файл сам).
- `.gitattributes` (`eol=lf`): рабочая копия, выгруженная раньше с `core.autocrlf=true`, остаётся в CRLF, пока файлы не
  перевыгрузить (`git rm --cached -r . && git reset --hard` на чистом дереве); иначе prettier видит `␍`.

## Деплой
`.github/workflows/deploy.yml` запускается только вручную (`workflow_dispatch`), не на `push` и не на `pull_request`. Для деплоя нужно:
- Ключ вместо SSH-пароля: `SSH_PRIVATE_KEY` в секретах, `key:` в `appleboy/ssh-action`, отдельный пользователь без
  `sudo -s`, пароль входа отключён.
- Окружения GitHub (`staging`, `production`): свои секреты (`SSH_HOST`, `SSH_USER`, ключ), у `production` ручное
  подтверждение; деплой запускается после зелёного `ci.yml` (`needs` или `workflow_run`), не на `pull_request`.
- Порядок на сервере: бэкап (`pg_dump` в файл с датой, проверить, что файл не пустой) → `git fetch` и checkout нужного
  коммита (без `git stash` и `git pull` поверх правок) → `npm ci` (не `npm i`) → `npm run build` →
  `npx prisma migrate deploy` → `pm2 reload xmenu-backend` → проверка живости и откат на предыдущий коммит и дамп,
  если проверка не прошла. Миграции только после бэкапа и только `migrate deploy`.
- Прод не стартует с `SMS_PROVIDER=console`, `OTP_DEV_MODE`, пустым `REVALIDATE_SECRET`, `DOMAIN_VERIFY_SKIP=true`, без
  `PLATFORM_DOMAIN`, с `TELEGRAM_API_BASE_URL` не на `https://api.telegram.org`, без https `PUBLIC_API_URL` и
  `DELIVERY_URL_TEMPLATE` (с `{slug}`), без годного `PAYMENT_CONFIG_KEY` и без учётных данных выбранного SMS-провайдера
  (`validateEnv`). Перед `pm2 reload` на сервере: `node dist/config/env/check-env.cli.js` (или `npm run check:env`); перед
  первым запуском: staging, бэкапы по расписанию, чек-лист безопасности (корневой `CLAUDE.md`, очередь, п. 6).

## Ошибки
Контракт: `docs/API.md`, «Ошибки»; список кодов `docs/ERRORS.md` (генерируется).
- Одна форма для обоих контуров: `{ code, message, status, fields?, retryAfter?, details?, requestId }`. Пишет её
  глобальный `AppErrorFilter` (`infra/errors/app-error-filter.ts`); `configureErrorHandling` (`infra/errors/configure.ts`)
  подключает его, `requestIdMiddleware` (`X-Request-Id`), парсеры тела (битый JSON → `invalid_body`) и пайп валидации
  в `main.ts` и в `createHttpApp` для HTTP-спеков. Своих фильтров на контроллерах нет.
- Коды только из реестра `infra/errors/error-codes.ts` (`ERROR_CODES`: статус, сообщение по умолчанию, когда, какие
  ключи `details` можно отдавать; лишние ключи фильтр отбрасывает с warn в лог). Бросаем только
  `AppException(code, { message?, details?, fields?, retryAfter?, cause? })`; Nest-исключения в коде не используем.
  Код не переименовывается и не используется повторно: новый смысл = новый код, старый получает `deprecated`.
- `message` для разработчика, по-английски, без имён переменных, путей, текстов исключений и ответов сервисов.
  Внутренняя причина в `cause` (уходит только в лог с `requestId`). Исключения фреймворка сохраняют статус, но не
  текст; прочее → `500 internal_error`.
- Каждый ответ с ошибкой пишет одну строку в лог (`[requestId] МЕТОД шаблон-маршрута статус code`): 4xx `warn`, 5xx `error` со
  стеком; без тела запроса, телефоны в причине маскирует `maskPhones` (`infra/helper/error-text.ts`).
- Функция выключена настройкой платформы: `platformMisconfigured(feature, cause)` → `503 platform_misconfigured`,
  `details.feature` (`MisconfiguredFeature`).
- `npm run check:user-texts` (`src/tools/user-texts`, шаг CI): строки внутри `new …Exception(…)` и `{ field, message }`,
  файлы текстов бота и SMS (`BOT_TEXT_FILES`), `errorMessage`/`errorStack`/`telegramErrorText` вне вызова логгера.
  Исключения по файлам с причиной: `ERROR_TEXT_ALLOWED` (ops-чат платформы, сам фильтр). Новый файл с текстами бота
  добавь в `BOT_TEXT_FILES`.

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
