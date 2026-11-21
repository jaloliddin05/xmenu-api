# xmenu-backend: единый API (api.xmenu.uz)

Общий контекст, решения и очередь задач: `../CLAUDE.md`. Обслуживает админку, QR-меню и клиентский фронт доставки.
Стадия: разработка и тестирование MVP; прода, клиентов и реальных данных нет, обратная совместимость не нужна.

## Стек
NestJS 11, TypeScript, Prisma 6 + PostgreSQL 16, Redis + BullMQ, Passport (JWT), class-validator,
Swagger (`/docs`; в production только при `SWAGGER_ENABLED=true`, `swaggerEnabled` в `src/swagger.ts`), Jest. Prettier: одинарные кавычки, trailing comma `all`, отступ 2 пробела, с `;`.
Комментарии частично на узбекском, документация на русском; новые комментарии на английском.

## Команды
`npm run start:dev` · `npm run build` · `npm run lint` · `npm run format:check` · `npm run format` · `npm run lint:fix` · `npm test` ·
`npm run test:e2e` · `npm run openapi` · `npm run check:env` · `npm run check:user-texts`
(`openapi` собирает проект и пишет `docs/openapi.json`, `docs/ERRORS.md` и матрицу прав в `docs/API.md` из сборки, без БД и Redis; остальной `docs/API.md` правится руками;
`check:env` проверяет `.env` той же схемой, что старт, `-- --production` как production; `check:user-texts` см. «Ошибки»).
Миграции: `npm run migrate` (собирает схему и запускает `prisma migrate dev`), на сервере контейнер `migrate` (`prisma migrate deploy`, «Продакшен»).
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
`https://api.telegram.org`), `IIKO_APP_ID` + `IIKO_CLIENT_SECRET` (приложение интегратора iiko, одно на платформу; без
них `platform_misconfigured`, `feature: pos`), `IIKO_API_BASE_URL` (`infra/iiko/iiko-api-url.ts`; фейк в тестах, в production
только `https://` на хосте из `IIKO_OFFICIAL_API_HOSTS`), `IIKO_MENU_IMPORT_MINUTES` (интервал импорта меню, 30 по
умолчанию), `IIKO_IMAGE_HOSTS` (хосты фото меню iiko, пусто = любой публичный), `OPS_CHAT_ID`, `ORDER_QUEUES`,
`ORDER_ACTIVE_LIMIT_PER_CUSTOMER` + `ORDER_HOURLY_LIMIT_PER_CUSTOMER` (лимиты заказов гостя), `SMS_DAILY_LIMIT_PLATFORM` +
`SMS_DAILY_LIMIT_TENANT` (суточные потолки SMS, в production обязательны), `SWAGGER_ENABLED`,
`MINIAPP_URL`, `UPLOAD_MAX_BYTES`, `PLATFORM_ADMIN_USER_IDS`, `TRANSLATION_*`, `OPENAI_API_KEY` (необязателен: без него
`/translation` → `503 platform_misconfigured`, `feature: translation`), `NEXT_PUBLIC_URL` + `REVALIDATE_SECRET` (QR),
`CLIENT_REVALIDATE_URL` + `CLIENT_REVALIDATE_SECRET` (сайт доставки), `DELIVERY_URL_TEMPLATE` (адрес Mini App для кнопки бота),
`PLATFORM_DOMAIN` (`xmenu.uz`; в dev `localhost`), `DOMAIN_VERIFY_SKIP` (только dev), `DOMAIN_VERIFY_DNS_SERVERS` (DNS проверки доменов, фейк в e2e), `STAFF_REFRESH_TTL_DAYS`,
`STAFF_SESSION_ABSOLUTE_DAYS`, `STAFF_STEP_UP_SECRET` (step-up, в production ≥ 32 символа и не равен другим секретам), `PUBLIC_POST_RATE_*`, `APPLICATION_RATE_*`, `TRANSLATION_IP_RATE_*` (лимиты по IP). Окончания строк LF (`.gitattributes`, `.editorconfig`).

## Схема Prisma
Не правь `prisma/schema.prisma` руками: он собирается из `src/modules/*/models/*.prisma` командой
`npm run generate-schema`. Меняй модельные файлы, потом `npm run migrate`.

## Модули
`auth` (два контура: staff и customer; права staff в `auth/access`), `staff` (сотрудники заведения: список, приглашение
и отключение операторов), `tenant` (`TenantGuard`, `TenantService`: тенант по id; `GET /tenant/by-slug`,
`GET /tenant/config` в `TenantConfigModule`), `organization` (+ настройки заведения), `user`, `employee` (не
используется), `branch`, `category`, `product` (+ группы допов), `menu` (публичный), `customer` (+ адреса),
`order` (state machine, очереди, уведомления), `delivery` (правила цены доставки филиалов, расчёт для корзины и
заказа), `courier` (свои курьеры: смены и сверка наличных, назначение, бот курьера, таймеры доставки, оплата курьерам,
провайдеры доставки), `report` (отчёты доставки для владельца), `payment` (Click, Payme, ключи тенанта, возвраты),
`sms` (провайдеры eskiz, telegram, console), `telegram` (боты заведений: `TelegramBotService`, `TelegramClient`,
`/telegram-bot`), `tenant-domain` (свои домены заведения, `/organization/:id/domains`), `file`, `translation`, `application`,
`health` (`GET /health`, `/health/ready`), `csp-report` (`POST /csp-report`, приёмник отчётов CSP фронтов, `docs/API.md`, «Отчёты CSP»), `revalidate-queue` (`RevalidateModule`: ревалидация QR-меню и сайта доставки, `docs/REVALIDATE.md`), `guest-login` (способы входа
клиентов заведения: `GuestLoginService`), `pos` (интеграция с кассой iiko: подключение, меню, стоп-лист, вебхук, отправка заказов и статусы; раздел
«Интеграция с кассой»).

## Контракт API
Единое место: `docs/API.md` и `docs/openapi.json`. Подробности: `docs/ORDERS_API.md`, `docs/BRANCHES_API.md`,
`docs/BACKEND_ORDERS.md`, `docs/TELEGRAM_VERIFICATION.md`. Меняешь контроллер или DTO: добавь `@ApiProperty` и
`@ApiOperation`, запусти `npm run openapi`, закоммить результат вместе с кодом. `.github/workflows/ci.yml` (build,
test, `npm run openapi` + `git diff --exit-code docs/`, `format:check`, `lint` и `check:user-texts` блокирующие) проверяет это на PR. Шаги: чистая БД `migrate deploy`, `migrate diff` без расхождений, `scripts/check-migration-upgrade.sh`, build, test, openapi); `deploy.yml` отдельный и без проверок, запускается только вручную (`workflow_dispatch`), см. «Продакшен».
Локально те же шаги: временные БД (`createdb xmenu_ci`, `xmenu_ci_shadow`, `xmenu_upgrade`), `DATABASE_URL=… npx prisma migrate deploy`, `npx prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel prisma/schema.prisma --exit-code`, `DATABASE_URL=<пустая БД> scripts/check-migration-upgrade.sh`, затем `npm run build`, `npm test`, `npm run openapi && git diff --exit-code docs/`. В Windows psql принимает URL только через `--dbname=`.

## Тенантность
- Тенант только по `organization.id` (UUID, не меняется): `parseTenantId` (`tenant/tenant-key.ts`), `TenantService.resolve`
  (кэш 30 с, `invalidate(id)`), `TenantGuard` по `X-Tenant-Id`. Slug в заголовке → `tenant_not_found` без запроса в БД.
  Запасного пути по slug нет. Вебхуки оплаты по id: `payments/click/:tenantId`, `payments/payme/:tenantId`.
- `GET /tenant/by-slug/:slug` → `{ id, slug }` (только активные). `GET /tenant/config` → публичный конфиг
  (`tenant-config.service.ts`): незаполненное `null`, `delivery` в режимах только если у доставляющего филиала есть правила цены (`fulfillmentModes`).
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
  /organization/:id`; кэш настроек заказа сбрасывает `PUT /order-settings`. Другие процессы API видят старое до 30 с.
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
- `organization_settings` (бренд, валюта, языки, контакты, карта) и `organization_order_settings` (минимум самовывоза,
  шаг округления цены доставки, способ доставки `courier_mode`, тайм-ауты): по одной строке на заведение, обе создаются в `OrganizationService.create` при регистрации
  значениями из `organization/domain/platform-defaults.ts`. У колонок нет `DEFAULT` в БД.
- Чтение не подставляет значения: нет строки → `settings_missing` (500) с логом. Исключение — тема:
  `PLATFORM_THEME` (`platform-defaults.ts`, 9 нейтральных цветов) и `resolveTheme()` дают полную `theme` в
  `GET /tenant/config` и `effectiveTheme` и `platformTheme` (чистые цвета платформы) в ответах `GET/PUT /organization/:id/settings` (хранимая `theme` не меняется).
- Владелец: `GET/PUT /organization/:id/settings` (PUT заменяет документ целиком, проверки в
  `organization/domain/organization-settings.ts` и DTO), `GET/PUT /order-settings`.
- Примерного времени доставки нет нигде (ни в настройках, ни в заказе, ни в ответах).
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
  на всех семи днях. Выбор филиала для заказа: `order/domain/branch-choice.ts` (`choosePickupBranch`,
  `chooseDeliveryBranch`).

## Стоимость доставки
Контракт: `docs/API.md`, «Стоимость доставки»; спецификация `../docs/DELIVERY.md`.
- Правила у филиала: `branch_delivery_zone` (многоугольники по `position`, первая содержащая адрес побеждает) и
  `branch_delivery_distance` (необязательное правило по расстоянию по прямой). Нет ни того, ни другого: филиал не
  доставляет. Расчёт чистыми функциями `branch/domain/delivery-pricing.ts` (зона → расстояние до `max_km` включительно
  → нет; начатый км сверх включённых; `free_from` → 0; округление вверх до `delivery_price_step` заведения).
- Модуль `delivery`: `DeliveryPricingService` (`GET/PUT /branch/:id/delivery-pricing`, чужой филиал 404),
  `DeliveryQuoteService` (`choose` для `POST /orders`, `quote` для `GET /delivery/quote`, `check` для владельца). Корзина
  и заказ идут одним путём, цена фиксируется в `customer_order.delivery_fee`; клиент шлёт `expectedDeliveryFee`, при
  расхождении `409 delivery_fee_changed`.
- Филиал доставки: открытые, с `accepts_delivery`, покрывающие адрес по своим правилам; ближайший по прямой. `branchId`
  в заказе доставки не учитывается.
- Способы оплаты при доставке: `delivery_pay_cash|card|online` в `organization_order_settings` (`deliveryPayment`,
  по умолчанию только наличные); действующий список считает `deliveryPaymentMethods` (`order/domain/delivery-payment.ts`):
  при `courier_mode = external` ни наличных, ни карты курьеру, онлайн только с подключённым провайдером. Им пользуются
  `/tenant/config` (`deliveryPaymentMethods`, `cashOnDelivery`), `/checkout-config` и `POST /orders`; кнопки оплаты
  курьера `doorPaymentChoices`. Способ заказа `card` = карта курьеру у двери (`paidAtDoor`: `cash`, `card`).
  Доставка не остаётся без способа: `PUT /order-settings` (`deliveryPaymentProblems`, код поля
  `delivery_payment_none_available`) и отключение провайдера (`PaymentConfigService`, `providerDisableLeavesNoMethod`,
  `409 delivery_payment_last_method`) проверяют итог под блокировкой строки `organization`
  (`order/services/delivery-payment-state.ts`); пункт чеклиста `delivery_payment` блокирует публикацию.
  `cash_change_from` в заказе: только наличные, не меньше `total`.

## Заказы
`OrderTransitionService` единственный путь смены статуса (автомат, optimistic locking по `version`, журнал).
Оплату подтверждает только вебхук провайдера. Эскалация: 45 с повтор в Telegram, 120 с SMS, 300 с авто-отмена и
возврат. Робозвонка в цепочке нет: задачи `esc-call`, оставшиеся в Redis, молча пропускаются. Click возвращает автоматически,
Payme вручную через ops-чат.
- Автомат различает тип заказа (`only` в правилах `order-state-machine.ts`): у доставки нет `preparing`, «В пути» и
  «Доставлен» ставит исполнитель `courier` (`transitionInTx` проверяет, что это назначенный заказу курьер,
  `CourierNotAssignedError`) или `pos` (статусы iiko, раздел «Интеграция с кассой»). Тест сверяет весь список переходов со схемой `../docs/DELIVERY.md`.
- Действия без смены статуса (назначение, снятие курьера) пишутся в журнал `recordInTx` (`from = to`, `note`).
- Эффекты после коммита: `courier_card` (очередь `courier-cards`, ключ задания с `version` заказа), `operator_alert`
  (срочное сообщение в чат филиала, `RestaurantNotifierService.alertDeliveryProblem`), `pos_job` и `pos_alert` (iiko).

## Интеграция с кассой (iiko)
Контракт: `docs/API.md`, «Интеграция с кассой (iiko)» и «Передача заказа в iiko»; спецификация `../docs/IIKO.md`.
Модуль `pos`: подключение, связи, меню, стоп-лист, вебхук, отправка принятых заказов, статусы iiko, режим курьеров.
- Интерфейс `provider/pos-provider.ts` (`POS_PROVIDER`), адаптер `iiko/iiko.provider.ts`; транспорт `IikoApiClient`
  (маркер v2 по `appId` + `clientSecret` из env и ключу ресторана, в памяти процесса до `exp − 5 мин`, при 401 один
  повтор; ошибки без ключа, маркера и тела ответа, в лог `iikoErrorText`; HTTP-статусы → коды `pos_*`). Нормализация
  меню `iiko/iiko-menu.ts` (поля по OpenAPI iiko: `itemsGroups`, `sizePrices`, модификаторы по id).
- Модели `pos/models/pos.prisma`: `pos_integration` (одна на заведение, ключ `AES-256-GCM` `PAYMENT_CONFIG_KEY` через
  `PosKeyring`, `webhook_secret_hash`, тревога владельцу `alert`/`alert_at`), `pos_branch_link` (группа терминалов
  филиала; ценовая категория одна на заведение, у интеграции), `pos_payment_link`, `pos_menu_link` (строка меню ↔ позиция iiko,
  `@@unique([integration_id, kind, external_id])`, FK с cascade на строку меню), `pos_stop_item` (по филиалу; `option_id`
  = остановленный размер, без него блюдо целиком; уникальность двумя частичными индексами в миграции). У переводов
  меню `stale`, у `file` `content_hash` и `from_pos`. «Работает» = `active` или `needs_reconnect` (`isPosLive`,
  `domain/pos-steps.ts`); `draft` и `disconnected` в заказах, меню и курьерах не участвуют.
- Отключение (`PosIntegrationService.disconnect`) интеграцию не удаляет: под блокировкой снимает связи, связи меню,
  стоп-лист и ключ, ставит `disconnected`; `pos_order` остаются (история передачи), ответ считает `unfinishedOrders`.
  Новый ключ после отключения начинает шаги заново на той же строке. Блокировка интеграции `pos/services/pos-lock.ts`
  (`pg_advisory_xact_lock` по id): её берут транзакции импорта меню, стоп-листа и отключения, импорт и стоп-лист под
  ней перечитывают статус; отключение ждёт до 10 с (`lock_timeout`), затем `409 pos_busy`. Тест на настоящем
  PostgreSQL `pos-lock.db.spec.ts` (идёт при заданном `DATABASE_URL`, в CI всегда).
- Импорт `PosMenuImportService`: чистый план `domain/menu-import-plan.ts`, затем одна транзакция; сбой оставляет меню
  и пишет код в `menu_import_error`, у работающей интеграции тревога владельцу (`PosAlertService`: `alert` и одно
  сообщение в чаты филиалов на эпизод), `pos_key_invalid` переводит `active` в `needs_reconnect`. Сопоставление по
  названию и скрытие блюд без пары только с `pairing: true` (включение, `POST /integrations/iiko/menu/rematch`);
  обычный импорт строки без связи не трогает. Пока интеграция работает, создание блюд, категорий и групп допов
  отвечает `409 pos_menu_locked` (`assertPosMenuOpen` в `product/services/pos-managed.ts`). Размеры → обязательная
  группа «Размер» (`size_group`/`size`). Фото `PosImageStore` (файл по sha256 в `uploads/image/products/pos`;
  `FileService.removeFile` не удаляет файл с диска, пока на путь ссылается другая строка). Адрес фото из меню
  заведения не доверяется (SSRF): редиректы вручную с проверкой каждого шага, `IIKO_IMAGE_HOSTS`, только публичные IP
  (`isPublicAddress` в `infra/http/internal-request.ts`; имя проверяет `publicOnlyLookup` из `infra/http/public-lookup.ts`
  в агенте, соединение идёт на проверенный адрес), прокси из окружения выключен. Новый исходящий запрос по адресу
  из внешних данных делай так же. Вне production фото с адреса `IIKO_API_BASE_URL` (фейк iiko) проверку IP пропускают.
- Только чтение у связанных строк: `product/services/pos-managed.ts` (`posSourceLang`, `pos_managed_field`) в сервисах
  блюд, категорий и допов; `posMarker` даёт `pos` в ответах владельца.
- Стоп-лист `PosStopListService` (чистые правила `domain/stop-list.ts`); `GET /menu` и `POST /orders`
  (`assertNotStopped` после выбора филиала, `reason: stop_list`) читают `pos_stop_item`, скрытое в iiko исключают
  через `pos_link.hidden_in_pos` (`SHOWN_BY_POS` в `menu.service.ts`, `loadProducts` в заказе).
- Очередь `pos-sync` (`PosSyncQueue`): задания `menu` (один ожидающий на интеграцию) и `stop-list`, расписание
  импорта каждые `IIKO_MENU_IMPORT_MINUTES` (`upsertJobScheduler`, `pos-menu-<id>`; при старте процесса расписания
  работающих интеграций ставятся заново, так новое значение применяется); при `ORDER_QUEUES=off` работа идёт в
  запросе.
  Обработчик берёт одно задание за раз, но в каждом процессе pm2 свой: при нескольких процессах два импорта одного
  заведения могут совпасть, второй упрётся в уникальный индекс `pos_menu_link` и запишет `menu_import_error`.
- Вебхук `PosWebhookService`: `Authorization` против sha256 (`infra/http/webhook-secret.ts`, общий с ботом заведения),
  одинаковый 401, дедупликация событий в Redis (`pos:evt:<id>:<sha256 события>`, 24 ч). Ответ сразу после записи
  событий: события заказов идут заданием `event` в `pos-orders` (5 попыток), без очередей обрабатываются в запросе.
- Передача заказа: `pos_order` (одна строка на заказ, `state`: `queued | sending | sent | failed | needs_street |
  manual`, причина `error`, `alerted` — одна тревога на состояние) создаёт `OrderTransitionService` при `accepted` в той
  же транзакции, если филиал связан с работающей интеграцией; эффект `pos_job` ставит задание `push` в очередь
  `pos-orders` (имя и тип в `order/queue/order-queue.service.ts`, обработчик `PosOrderProcessor` в `pos`, как у
  `courier-cards`). Без очередей заказ остаётся `queued`.
- `PosOrderService`: сборка заказа чистой `domain/pos-order-draft.ts` по `pos_menu_link` (размер: `size_id` у связи
  опции, у позиции с одним размером у связи блюда; модификатор: `<itemId>/<groupId>/<modifierId>` в `external_id`),
  попытка с захватом условным `updateMany` (`state`, `attempts`), итог команды заданием `check` (3 с, до 20 раз),
  классификация `domain/pos-order-errors.ts` (повтор или сразу `failed`; 5 попыток, паузы 1–4 минуты), `confirm` после
  создания, один раз (`pos_order.confirmed_at`, захват условным `updateMany`). `401` переводит интеграцию в
  `needs_reconnect` (`PosAlertService.needsReconnect`: тревога `key_revoked` и каждый переход в ops-чат), `402/403/423` красят `checks`. Отказ приложения платформы (текст iiko
  называет приложение или ключи двух заведений отклонены за 10 минут без единого выданного маркера в процессе,
  `PosAlertService.keyRejected`) =
  `platform_misconfigured`: заведения не переподключаются, тревога в ops-чат. Ценовая категория заведения (в ней же импортированы
  цены меню) уходит в `deliveries/create`. Адрес не `city`: улица и дом сначала сопоставляются со строкой адреса (`domain/street-match.ts`
  по справочнику `PosStreetsCache`: города и улицы организации в Redis на сутки), иначе `needs_street`. Действия
  оператора `PosOrderController` (`/order/:id/pos/*`, право `orders`).
- Статусы: чистая таблица `domain/pos-status-map.ts` (только вперёд, противоречие → журнал и тревога),
  `PosOrderStatusService.apply` для вебхука (`DeliveryOrderUpdate/Error` в `PosWebhookService`) и опроса (задание
  `poll` каждые 5 минут, расписание `pos-poll-<id>` ставит и снимает `PosSyncQueue` вместе с импортом меню); последний
  статус iiko меняется условным `updateMany` (одно событие учитывается один раз). Исполнитель `pos` в автомате заказа.
- Курьеры Xmenu: `completed` от `courier` у переданного заказа ставит `delivered_push: pending` и задание
  `delivered`: шаги по текущему статусу iiko (`domain/delivered-push.ts`: из `Waiting` `OnWay` и `Delivered`, из
  `OnWay` `Delivered`), из недопустимого статуса ничего не шлётся, `delivered_push: failed` и тревога, без повторов. Курьеры iiko: `OwnCouriersGuard` (`courier/own-couriers.guard.ts`) на
  курьерских маршрутах и отчёте по курьерам → `409 pos_couriers_managed`; имя курьера iiko в `pos_order.courier_name`
  (гостю в `courier`). Отмена в Xmenu переданного заказа: только тревога (изменение после отправки не входит в MVP).
- Тревоги: `RestaurantNotifierService.alertPos` / `alertPosReconnect`, тексты `buildPosAlertText` в
  `order/notifications/order-messages.ts`. В списке заказов `posState`, `reminders.posFailed|posReconnect|posCouriers`.
- `POST /orders` у заведения с не-`draft` интеграцией требует `expectedTotal` (цены меняются с импортом).
- Тесты: ответы iiko подменяет `iiko/iiko-server.fake.ts` (HTTP-сервер в процессе), сервисы меню на
  `menu-prisma.fake.ts` (поддерживает `pos_*`, обратные связи `pos_link`, `AND`/`OR`, `notIn`), сервисы заказов на
  `services/pos-order.fake.ts` (заказ, интеграция и `pos_order` с условными обновлениями).

## Курьеры
Контракт: `docs/API.md`, «Курьеры»; спецификация `../docs/DELIVERY.md`. Модуль `courier`.
- Модели (`courier/models/courier.prisma`): `courier` (`@@unique([organization_id, phone])`,
  `@@unique([organization_id, telegram_user_id])`), `courier_invitation` (sha256 токена, 24 ч, одноразовое),
  `courier_shift` (частичный уникальный индекс «одна открытая смена на курьера» в миграции), `courier_card` (сообщение
  карточки на пару заказ–курьер); в `customer_order`: `courier_id`, `courier_assigned_at`, `courier_shift_id`,
  `door_problem`, `door_problem_reason`.
- Провайдер доставки: интерфейс `courier/provider/delivery-provider.ts`, адаптер `OwnCouriersProvider`. Апдейты бота
  заведения (`TelegramUpdateProcessor`) сначала идут в него (`CourierBotService`), остальное в проверку номера гостя.
  `setWebhook` бота заведения просит `message` и `callback_query`.
- `CourierAssignmentService`: назначение только курьеру на смене, до «Забрал» (`order_courier_locked` после), optimistic
  locking по `version`. Отключение курьера (`CourierService.disable`) снимает незавершённые заказы (в пути → `ready`
  от `system`) и заканчивает смену.
- Карточка: чистая `courier/domain/courier-card.ts` (тексты и кнопки, данные кнопок `cr:<действие>:<uuid>`), отправка и
  правка `CourierCardService` (не правится → новая карточка). Тексты бота: `courier/domain/courier-texts.ts` (в
  `BOT_TEXT_FILES`).
- Внешняя служба: адаптер `ExternalServiceProvider` (`handed_to_external` от `restaurant`, только без своего курьера:
  `order_courier_assigned`), поля `external_*` в заказе; отметка оплаты заказа с оплатой у двери (наличные или карта) и подсказки названий в
  `ExternalDeliveryService`.
- Таймеры доставки (`order/domain/delivery-timers.ts`): эффект `delivery_timers` после каждой смены статуса доставки
  удаляет задания заказа в очереди `delivery-timers` и ставит таймер нового статуса (`ready_at`, `picked_up_at`,
  `door_problem_at`; минуты из `organization_order_settings`); `DeliveryTimerProcessor` проверяет, что заказ ещё в том же
  эпизоде (`timerStillDue`), и пишет в чат филиала и курьеру.
- Наличные смены: `courier/domain/shift-cash.ts` (к сдаче = доставленные заказы смены с оплатой у двери, отмеченные купюрами,
  `cash_collected`), сверка один раз условным `updateMany` (`CourierShiftService.reconcile`).
- Оплата курьерам: `courier/domain/courier-pay.ts`, считается в `OrderTransitionService` при `completed` от курьера
  (`courier_distance_km`, `courier_pay`); ставка заведения в `organization_order_settings.courier_pay_*`, своя в
  `courier.pay_*`, маршруты ставок и отчёты только у владельца (`venue`, `reports`).
- Отчёты (`modules/report`): чистые сборщики `report/domain/*`, таблицы с заголовками на трёх языках `report-table.ts`
  (в `BOT_TEXT_FILES`), файлы `csv.ts` и `xlsx.ts` (XLSX собирается вручную из XML и `fflate`, без библиотеки таблиц), период
  `[from, to)` до 366 дней (`report-period.ts`).
- Тесты сервисов на фейке `courier/courier-prisma.fake.ts` с настоящим `OrderTransitionService`; общий сетап
  `courier/courier-setup.fake.ts`.

## Авторизация клиентов
Телефон + OTP (HMAC-хеш кода, TTL, лимит попыток, cooldown) через `SmsProvider`; refresh-токены с ротацией и
сессиями. `CustomerOtpService.issue()` не зависит от канала доставки (SMS или Telegram), лимиты по телефону общие.
Параметры и значения по умолчанию: `OTP_LENGTH`, `OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS`, `OTP_COOLDOWN_SECONDS` (см. `.env.example`).
Длина кода приходит в `codeLength`; фронты читают её из ответа, своих констант у них нет.
`otp/request` шлёт код только гостям заведения, которое принимает заказы (`orderingProblem` из БД, иначе
`422 ordering_channel_disabled` / `ordering_not_published` без SMS). Название заведения попадает в любую SMS только
через `smsBrand` (`auth/services/sms-brand.ts`: одна функция очистки, неподходящее имя → «Xmenu»); все тексты SMS с
переменными для модерации Eskiz: `docs/SMS-TEMPLATES.md`, новый или изменённый текст SMS правит и его.
`initData` проверяется сроком `TELEGRAM_INITDATA_MAX_AGE_SECONDS`; `auth_date` в будущем сверх
`INIT_DATA_CLOCK_SKEW_SECONDS` тоже отказ (`telegram-init-data.service.ts`).
`TelegramInitDataService.verifyForTenant` проверяет `initData` из тела токеном бота заведения (иначе платформенным
`TELEGRAM_BOT_TOKEN`); заголовок `X-Telegram-Init-Data` проверяет `MiniAppAccessService` только ботом заведения.
Вход по `initData` (`POST /auth/customer/login`) только для клиента с уже привязанным `telegram_id`. Подтверждение в Mini
App (`instant`) нового номера кладёт Telegram-id в `registrationToken` (`tg`), `register` его привязывает.

Язык клиента: `customer.language` (`ru|uz|en`, null до первого входа), задаётся из языка запроса (`RequestCtx.lang`,
`resolveLang`) при регистрации и первом входе, меняется `PATCH /customers/me`. SMS-коды берут язык запроса
(`SMS_TEXT` в `customer-otp.service.ts`), уведомления клиенту `customerLangFor` (язык клиента, если заведение его
предлагает, иначе язык заведения) и `CUSTOMER_TEXTS` (`order/notifications/customer-messages.ts`). `Accept-Language`
разбирается с q-весами (`acceptedLanguages` в `infra/http/request-helpers.ts`).

## Уведомления гостю о заказе
Контракт: `docs/API.md`, «Уведомления гостю о заказе». Правила в `order/notifications/guest-notification.ts`, отправка
`CustomerNotifierService`, очередь `guest-notifications` (`GuestNotificationProcessor`, 5 попыток).
- Только заказы из Mini App: `POST /orders` пишет `channel` (`site` | `miniapp`), `guest_telegram_id` и
  `guest_telegram_bot_id` из проверенного `X-Telegram-Init-Data` (`MiniAppAccessService.check`). Заказ с сайта
  уведомлений не получает, `customer.telegram_id` для них не используется. SMS о статусе нет.
- Пишет бот заведения (`TelegramBotService.forTenant` + `TelegramClient`), только если это тот же бот
  (`telegramBotId`); платформенный `TelegramApiService` только для персонала и ops.
- Не доставлено (нет бота, бот сменён, 403, 400 chat not found, другой 4xx, повторы кончились): строка в лог с id
  заказа и причиной, отметка `customer.telegram_unreachable_at`/`_reason`; доставленное снимает отметку.

## Боты заведений и подтверждение номера через Telegram
Контракт и сценарии: `docs/TELEGRAM_VERIFICATION.md`.
- `TelegramBotService` (`modules/telegram`): `GET/PUT/DELETE /telegram-bot` из админки. Таблица
  `organization_telegram_bot` (одна строка на заведение, `telegram_bot_id` уникален), токен зашифрован
  `PAYMENT_CONFIG_KEY`, `PUT` требует https `PUBLIC_API_URL`. Webhook `POST /telegram/bot/:botKey/webhook`
  (`botKey` = id строки, не slug): в БД sha256 секрета (`webhook_secret_hash`, `infra/http/webhook-secret.ts`), заголовок
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
- Уведомления о заказах персоналу филиала по-прежнему идут через платформенного бота (`telegram-orders.controller.ts`);
  гостю пишет бот заведения (раздел «Уведомления гостю о заказе»).

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
- Перебор номеров закрыт: `POST /auth/register` для зарегистрированного номера отвечает так же, как для свободного (тот же
  ответ, лимиты и время). Заявка помечается `existing`, вместо кода уходит SMS «У вас уже есть аккаунт» (`requestNotice`),
  `check-code` для неё всегда `invalid_code`. Пауза и лимиты по номеру ведутся по цели (`purpose`: `register`, `pwreset`)
  и не смотрят на аккаунт. Тесты: `staff-enumeration.spec.ts`, `otp-rate-limits.spec.ts`. Значения лимитов
  (`OTP_PHONE_HOURLY_LIMIT`, `OTP_PHONE_DAILY_LIMIT`, `OTP_IP_HOURLY_LIMIT`, `STAFF_REGISTER_IP_HOURLY_LIMIT`) из окружения,
  по умолчанию боевые.
- `POST /auth/register` ничего не пишет в БД: заявка (с bcrypt-хешем пароля владельца, 8–72 символа) ждёт в Redis
  под случайным `registrationId` 30 минут. `check-code {registrationId, code}` создаёт user и organization в одной
  транзакции; «хвост» старой схемы (`isActive=false`) переиспользуется. Код привязан к заявке, а не к номеру: вторая
  регистрация на тот же номер не может перехватить первую.
- Код выдаёт `CustomerOtpService` со `scope: 'staff'` (ключи `sotp:*`, свои лимиты, те же `OTP_*`), доставка через
  `SmsProvider`. `SMS_PROVIDER=console` и `OTP_DEV_MODE` в production не стартуют.
- Вход: лимит по IP и две нарастающие блокировки (`StaffLoginThrottleService`): пара «номер + IP» строгая, номер
  целиком с любых IP мягче (порог выше, блокировка короче), так чужой не держит владельца без входа; успешный вход
  обнуляет только свою пару, сброс пароля все счётчики номера (поколение номера в ключах пар). Числа: `docs/API.md`,
  «Лимиты». Единый `401 invalid_credentials` и одна bcrypt-проверка на любую неудачу (фиктивный хеш для неизвестного номера).
- Access-токен владельца: только HS256, `aud` `xmenu:staff`, `iss` `xmenu` (`STAFF_TOKEN` в `auth/jwt.service.ts`, подпись в
  `AuthModule`, проверка в `AccessTokenUserStrategy`); токен гостя и токен с другим алгоритмом не принимаются;
  `JWT_ACCESS_TOKEN_SECRET` в production не короче 32 символов (`staffAuthEnvIssues`).
- Токены staff принимаются только для существующего пользователя с `isActive=true` и активной строкой в
  `organization_member` (роль читается из БД на каждом запросе); хеш пароля не уходит в ответы.
- IP клиента: `trust proxy` из `TRUST_PROXY` (`infra/http/trust-proxy.ts`, по умолчанию `loopback`), прокси передаёт `X-Forwarded-For`.
- Владение данными: организация из `requireStaffOrganizationId(req)`; меню проверяется фрагментами из
  `product/services/menu-ownership.ts`; чужой id в пути или в теле → 404. Новые эндпоинты админки делай так же.

- Критичные действия владельца только со step-up: `@StepUp(action)` (`auth/step-up/step-up.decorator.ts`) на платёжных
  ключах, боте заведения, ключе и отключении iiko, удалении заведения и аккаунта. `POST /auth/step-up { password }` →
  токен на 5 минут (HS256, `STAFF_STEP_UP_SECRET`, `aud` `xmenu:step-up`, привязан к `sub` и `sid` входа; 5 неверных
  паролей за 15 минут на пользователя, блокировку входа не трогает), заголовок `X-Step-Up-Token`. `StepUpGuard`
  (глобальный, после `StaffAccessGuard`, в `main.ts` и `createHttpApp`) без токена → `403 step_up_required`.
  `StepUpAuditInterceptor` после успеха пишет `staff_<action>` в `staff_auth_event` (без значений) и ставит SMS владельцу
  в очередь `owner-notification` (`OwnerSecurityNotifier`, тексты `step-up/owner-security-texts.ts`). Новое критичное
  действие: `@StepUp` и строка в `STEP_UP_EXPECTED` в `staff-access.matrix.spec.ts`; в HTTP-спеках токен даёт
  `stepUpToken()` из `http-app.fake.ts`.
- Чат филиала для заказов только привязкой (`BranchChatBindingService` в `order`): `POST /branch/:id/telegram-chat/code`
  (код 8 символов, 10 минут, в Redis sha256, один на филиал), `/bind КОД` в группе платформенному боту
  (`TelegramOrdersController` читает `message`, лимит 5 за 10 минут на чат), `DELETE /branch/:id/telegram-chat`.
  `telegramChatId` в DTO филиала нет (лишнее поле → 400).

## Сотрудники и права
Контракт и матрица маршрутов: `docs/API.md`, «Сотрудники и права».
- Роли `owner` и `operator` в `organization_member` (модель в `user/models/organization-member.prisma`: `user_id`
  уникален, один пользователь в одном заведении; `@@unique([organization_id, phone])`). Колонки `organization.owner_id`
  нет: владелец заведения = строка с `role = owner`, её создаёт `OrganizationService.create` при регистрации.
  `toStaffUser` берёт заведение и роль из membership (`STAFF_USER_INCLUDE`) и отдаёт `role` и `permissions`.
- Права: `auth/access/permissions.ts` (`ROLE_PERMISSIONS`). Каждый не-`@Public` маршрут несёт `@StaffAccess(право,
  { orgParam? })` на методе (не на классе); `StaffAccessGuard` (глобальный, после `AccessTokenUserGuard`, в `main.ts`
  и `createHttpApp`) без правила отвечает 403, без права у роли 403, чужой id заведения в `orgParam` 404.
  `@PlatformAdminRoute()` отдаёт решение `PlatformAdminGuard`. Новый маршрут: правило в коде и строка в `EXPECTED`
  в `auth/access/staff-access.matrix.spec.ts` (иначе тест красный); матрицу в `docs/API.md` пишет `npm run openapi`
  (`collectRoutes`, `renderAccessMatrix` в `auth/access/route-rules.ts`), в OpenAPI поле `x-permission`.
- Курьеров добавляет, правит, приглашает и отключает только владелец (`couriers.manage`); оператор видит список
  (`couriers`), назначает (`orders`) и ведёт смены (`shifts`). Пороги напоминаний оператор получает в `GET /order`
  (`reminders`), `/order-settings` ему закрыт.
- Приглашение оператора: владелец `POST /organization/:id/staff` (72 ч, ничего не отправляет), оператор
  `POST /auth/invitation/code` (одинаковый ответ для любого номера, цель кода `invite`) и `/accept` (`StaffInvitationService`:
  user и активация membership в одной транзакции, условный `updateMany`). Приглашения одного номера сериализует
  `pg_advisory_xact_lock`. Отключение (`StaffService.disable`): membership `disabled`, `user.isActive = false`,
  `revokeAllForUser`; владельца отключить нельзя.

## Что нужно построить
- Адаптеры внешних служб (Noor, Yandex, Millennium) по мере доступа к API.
- Уведомления о заказах персоналу через бота ресторана (пока идут через платформенного бота из env).
- История старых slug с редиректом.
- Возврат после оплаты на сайт заведения: `MINIAPP_RETURN_URL`/`MINIAPP_URL` один на платформу
  (`payment/domain/payment-url.ts`), а не `https://{slug}.xmenu.uz`. Бэкенд адресов `{slug}.xmenu.uz` нигде не строит:
  slug только валидируется как поддомен (`organization/domain/slug.ts`).
- Роли сотрудников для отдельного приложения (курьеры, официанты, менеджеры). Таблица `employee` есть, не используется
  (операторы админки живут в `organization_member`, раздел «Сотрудники и права»).
- Касса iiko: проверка на живом iiko (`../docs/IIKO.md`, «Перед пилотом»). Другие кассы позже.
- Позже: Web Push/WebSocket для админки, фискальные чеки, промокоды (поле `discount` всегда 0), заказ ко
  времени, меню по филиалам, ротация `PAYMENT_CONFIG_KEY` (принятый риск S-12, `../audit/SECURITY.md`, раздел 7).

## Известные долги
- Сессии владельцев: «последняя активность» в списке сессий = последний refresh (запросы между refresh не пишутся в БД).
- Загрузки (`MulterStorage`) принимают только изображения (JPEG, PNG, GIF, WebP по содержимому, до `UPLOAD_MAX_BYTES`) и
  пишут на диск после проверки. Каждый интерцептор multer задаёт `limits: uploadLimits(файлов)` (`multer-upload.ts`:
  файлы, размер, поля, части); новый маршрут загрузки тоже. Но при 404 владельца в `PUT /organization`, `POST/PATCH /product…` файл, уже записанный
  валидатором, остаётся на диске без записи в БД.  Отдача делает любой не-образ `attachment` + `sandbox`.
- Ревалидация: ключ задания `revalidate-{target}-{route}-{tenantId}`, цели QR и сайт доставки (`docs/REVALIDATE.md`);
  в очередь идут tenantId, route, oldSlug, актуальный slug читается при выполнении; при заданном адресе цели и пустом
  секрете production не стартует (`revalidate-config.ts`); без `CLIENT_REVALIDATE_URL` задания клиенту не ставятся. В
  `GET /application` читать могут только id из `PLATFORM_ADMIN_USER_IDS`.
- Кэш тенанта и настроек заказа в памяти процесса (30 с): после `PUT` другие процессы API видят старые имя, slug,
  язык, валюту, шаг цены доставки и `courier_mode` до 30 с. `is_active` через API не меняется (только в БД), сброса для него нет.
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

## Продакшен
Docker Compose на одном сервере, снаружи Caddy (TLS, `api.xmenu.uz` → `api:4000`). api в двух сетях compose:
`edge` (Caddy, фронты, выход в интернет) и `data` (`internal: true`, PostgreSQL и Redis; фронтов в ней нет), схема в
`../infra/docker-compose.prod.yml` и корневом `CLAUDE.md`, «Продакшен». Образ собирается на сервере (`Dockerfile`, Node 22, Debian slim), `.dockerignore` не пускает в
контекст `.env`, `node_modules`, `dist`, `uploads`, тесты и фейки.
- Цели `Dockerfile`: `runtime` (по умолчанию: `node dist/main`, пользователь `node`, только production-зависимости и
  сгенерированный Prisma-клиент, `prisma generate` при сборке) и `migrate` (разовый контейнер с Prisma CLI:
  `prisma migrate deploy`). Приложение миграции при старте не применяет: сначала `docker compose run --rm migrate`, потом
  перезапуск `api`. Миграции только после бэкапа (`pg_dump` в файл с датой, файл не пустой).
- Порт `4000` (`PORT` задан в образе). `HEALTHCHECK` образа ходит в `GET /health`. Проверки: `GET /health` (жив процесс,
  без базы и Redis), `GET /health/ready` (база и Redis, иначе `503`), контракт `docs/API.md`, «Служебные маршруты».
- Загрузки: том на `/app/uploads` (владелец `node`), отдаются с корня сайта; `PUBLIC_FILES_URL` = публичный адрес API.
- Переменные запуска: весь `.env.example` (production проверяется `validateEnv`, без ошибок не стартует; проверка без
  запуска в контейнере: `node dist/config/env/check-env.cli.js`). Для Docker важны: `NODE_ENV=production`,
  `DATABASE_URL` (хост сервиса базы), `REDIS_URL` (`redis://:<пароль>@redis:6379`: Redis с паролем, адрес собирает
  `../infra/scripts/gen-secrets.sh`; пароль из него берут и `RedisModule`, и BullMQ через `bullConnection()`,
  тест `infra/redis/bull-connection.spec.ts`), `TRUST_PROXY` (адрес Caddy в сети `edge` compose или
  `uniquelocal`, иначе все гости получат IP Caddy и общие лимиты), `NEXT_PUBLIC_URL=http://qr:3000` и
  `CLIENT_REVALIDATE_URL=http://client:3000/api/revalidate` (ревалидация по внутренней сети, не через Caddy),
  `PUBLIC_API_URL=https://api.xmenu.uz`, `PLATFORM_DOMAIN=xmenu.uz`, `DELIVERY_URL_TEMPLATE=https://{slug}.xmenu.uz`.
- Сертификаты: поддомены `{slug}.xmenu.uz` под одним wildcard-сертификатом `*.xmenu.uz` (DNS-01 через Cloudflare,
  API не спрашивается); свои домены заведений: on-demand TLS Caddy с вопросом к API `GET /internal/tls/allow?domain=…`
  (200 только для `{slug}.PLATFORM_DOMAIN` и подтверждённого домена активного заведения, отвечает только изнутри сети,
  без заголовков прокси: `tenant/internal-tls.controller.ts`, `infra/http/internal-request.ts`). Полный Caddyfile:
  `../infra/caddy/Caddyfile` (корневой репозиторий), сокращённо:

  ```caddyfile
  {
  	on_demand_tls {
  		ask http://api:4000/internal/tls/allow
  	}
  }
  api.xmenu.uz {
  	respond /internal/* 404
  	request_body {
  		max_size 10MB
  	}
  	reverse_proxy api:4000
  }
  *.xmenu.uz {
  	tls {
  		dns cloudflare {env.CF_API_TOKEN}
  	}
  	reverse_proxy client:3000
  }
  https:// {
  	tls {
  		on_demand
  	}
  	reverse_proxy client:3000
  }
  ```
  Caddy передаёт исходный `Host` и ставит `X-Forwarded-For`, `-Proto`, `-Host`; `api`, `dashboard`, `qr`, `app`
  (редирект на `qr`) описаны отдельными сайтами, зарезервированные имена из `RESERVED_SLUGS` под `*.xmenu.uz` отдают
  404 (список в Caddyfile ведётся вручную), всё прочее идёт в `client`. `TRUST_PROXY` = фиксированный адрес Caddy в
  сети `edge` (`172.30.0.10`, `../infra/docker-compose.prod.yml`).
- `.github/workflows/deploy.yml` (старый деплой через SSH, `git pull` и pm2) запускается только вручную и под Docker не
  переделан; не запускай его.
- Прод не стартует с `SMS_PROVIDER=console`, `OTP_DEV_MODE`, пустым `REVALIDATE_SECRET`, `DOMAIN_VERIFY_SKIP=true`, без
  `PLATFORM_DOMAIN`, с `TELEGRAM_API_BASE_URL` не на `https://api.telegram.org`, без https `PUBLIC_API_URL` и
  `DELIVERY_URL_TEMPLATE` (с `{slug}`), без годного `PAYMENT_CONFIG_KEY`, с неразбираемым `TRUST_PROXY`, без учётных
  данных выбранного SMS-провайдера, без `SMS_DAILY_LIMIT_PLATFORM` и `SMS_DAILY_LIMIT_TENANT`, с коротким
  `JWT_ACCESS_TOKEN_SECRET` (`validateEnv`). `/docs` в production не публикуется без `SWAGGER_ENABLED=true`. Перед первым запуском: staging, бэкапы по расписанию, чек-лист
  безопасности (корневой `CLAUDE.md`, очередь, п. 6).

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

## Бюджет SMS
`SmsBudgetService` (`sms/sms-budget.service.ts`): суточные потолки SMS платформы и заведения в Redis, сутки по
Asia/Tashkent. `SMS_PROVIDER` отдаёт `BudgetedSmsProvider` поверх выбранного провайдера, так любая SMS проходит
потолки; `send(phone, text, { tenantId })` считает и в потолок заведения (коды гостей, эскалация филиалу), без
`tenantId` только в платформенный (владельцы). На пороге предупреждения и сверх потолка по одной тревоге в ops-чат за
сутки на потолок; сверх потолка `429 sms_limit` (`retryAfter` до полуночи по Ташкенту), `CustomerOtpService` отдаёт его
как есть. Отправка без ожидания (сброс пароля, приглашение) проверяет потолок заранее `assertAvailable()` для любого
номера; эскалация при потолке пишет в ops-чат и не падает. Без переменных (только вне production) потолков нет.

## Лимиты заказов гостя
`POST /orders` в транзакции записи, под блокировкой строки заведения (`UPDATE … order_seq`): незавершённые заказы гостя
не больше меньшего из `maxActiveOrders` заведения и `ORDER_ACTIVE_LIMIT_PER_CUSTOMER` (`429 too_many_active_orders`),
заказы за последний час не больше `ORDER_HOURLY_LIMIT_PER_CUSTOMER` (`429 rate_limited`); `order/domain/order-limits.ts`.

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
