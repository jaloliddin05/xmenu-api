# xmenu-backend: единый API (api.xmenu.uz)

Общий контекст, решения и очередь задач: `../CLAUDE.md`. Обслуживает админку, QR-меню и клиентский фронт доставки.

## Стек
NestJS 11, TypeScript, Prisma 6 + PostgreSQL 16, Redis + BullMQ, Passport (JWT), class-validator,
Swagger (`/docs`), Jest. Prettier: одинарные кавычки, trailing comma `all`, отступ 2 пробела, с `;`.
Комментарии частично на узбекском, документация на русском; новые комментарии на английском.

## Команды
`npm run start:dev` · `npm run build` · `npm run lint` · `npm test` · `npm run test:e2e` · `npm run openapi`
(`openapi` собирает проект и пишет `docs/openapi.json` из сборки, без БД и Redis; `docs/API.md` правится руками).
Миграции: `npm run migrate` (собирает схему и запускает `prisma migrate dev`), на сервере `npx prisma migrate deploy`.
Env: см. `.env.example`. Ключевые: `JWT_*`, `OTP_*`, `SMS_PROVIDER`, `PAYMENT_CONFIG_KEY`, `REDIS_URL`, `PUBLIC_API_URL`,
`TENANT_ALLOW_SLUG`, `TELEGRAM_*`, `UPLOAD_MAX_BYTES`, `PLATFORM_ADMIN_USER_IDS`, `TRANSLATION_*`.

## Схема Prisma
Не правь `prisma/schema.prisma` руками: он собирается из `src/modules/*/models/*.prisma` командой
`npm run generate-schema`. Меняй модельные файлы, потом `npm run migrate`.

## Модули
`auth` (два контура: staff и customer), `tenant` (id и slug → тенант), `organization`, `user`, `employee` (пока не
используется), `branch`, `category`, `product` (+ группы допов), `menu` (публичный), `customer` (+ адреса),
`order` (state machine, очереди, уведомления), `payment` (Click, Payme, ключи тенанта, возвраты),
`sms` (провайдеры eskiz, telegram, console), `telegram` (боты ресторанов), `file`, `translation`, `application`,
`revalidate-queue` (инвалидация кэша QR).

## Контракт API
Единое место: `docs/API.md` и `docs/openapi.json`. Подробности: `docs/ORDERS_API.md`, `docs/BRANCHES_API.md`,
`docs/TELEGRAM_VERIFICATION.md`, `docs/BACKEND_ORDERS.md`. Меняешь контроллер или DTO: добавь `@ApiProperty` и
`@ApiOperation`, запусти `npm run openapi`, закоммить результат вместе с кодом. Проверки контракта в CI пока нет
(в `.github/workflows` только `deploy.yml`).

## Тенантность
- Тенант = `organization`, идентификатор `organization.id` (UUID, не меняется). Клиентские эндпоинты определяют его по
  `X-Tenant-Id`, вебхуки оплаты по id в URL. Slug принимается только как устаревший вариант
  (`src/modules/tenant/tenant-key.ts`, флаг `TENANT_ALLOW_SLUG`); каждый пришедший slug логируется один раз.
  `GET /tenant/by-slug/:slug` отдаёт фронтам id. UUID-подобные slug запрещены.
- Тенант и клиент берутся из токена и заголовка, не из тела запроса. Каждый запрос и выборка привязаны к тенанту.
- Платёжные ключи и токены ботов шифруются AES-256-GCM (`PAYMENT_CONFIG_KEY`). Потеря ключа: все вводят заново.

## Заказы
`OrderTransitionService` единственный путь смены статуса (автомат, optimistic locking по `version`, журнал).
Оплату подтверждает только вебхук провайдера. Эскалация: 45 с повтор в Telegram, 120 с SMS, 300 с авто-отмена и
возврат (робозвонка нет; старые задачи `esc-call` в Redis процессор молча пропускает). Click возвращает автоматически,
Payme вручную через ops-чат.

## Авторизация клиентов
Телефон + OTP (HMAC-хеш кода, TTL, лимит попыток, cooldown) через `SmsProvider`; refresh-токены с ротацией и
сессиями. `CustomerOtpService.issue()` не зависит от канала доставки (SMS или Telegram), лимиты по телефону общие.
Целевые параметры: `OTP_LENGTH=6`, `OTP_TTL_SECONDS=300`, `OTP_MAX_ATTEMPTS=5`, `OTP_COOLDOWN_SECONDS=60`
(сейчас по умолчанию длина 4: поменять значение по умолчанию и согласовать с фронтами).
`TelegramInitDataService` проверяет `initData` токеном бота тенанта (иначе платформенным) и входом не является.

## Подтверждение номера через Telegram
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
Payme), Telegram webhook и кнопки, нагрузка. Стендов Click/Payme нет. Telegram-верификация покрыта тестами с подменой
Telegram; на реальном боте (особенно `requestContact()` в Mini App) не проверена. Миграция
`20261019120000_organization_telegram_bot` написана вручную и на живой БД не применялась.

## Известные долги
- Refresh-токены staff без ротации и отзыва (выход не инвалидирует токен; удаление пользователя инвалидирует).
  Восстановления пароля для владельцев нет.
- Дашборд ещё на старом контракте регистрации (код `1111`, `?token=`): до его обновления регистрация в админке не
  работает. Что поменять: `docs/API.md`, «Авторизация владельцев».
- Загрузки (`MulterStorage`) принимают только изображения (JPEG, PNG, GIF, WebP по содержимому, до `UPLOAD_MAX_BYTES`) и
  пишут на диск после проверки. Но при 404 владельца в `PUT /organization`, `POST/PATCH /product…` файл, уже записанный
  валидатором, остаётся на диске без записи в БД. Уже лежащие на проде файлы не проверялись: отдача делает любой
  не-образ `attachment` + `sandbox`, сами файлы не чистились.
- Ревалидация: ключ задания `revalidate-{route}-{slug|id}` (`docs/REVALIDATE.md`); бэкенд и QR расходятся по формату
  тела при смене slug (Q-01, чинится в QR). В `GET /application` читать могут только id из `PLATFORM_ADMIN_USER_IDS`.
- Группы допов, созданные до миграции `additional_product_group_organization` и не привязанные к блюду, без владельца
  (недоступны никому); можно удалить вручную.
- Slug ещё принимается как ключ тенанта: после перехода фронтов и кабинетов Click/Payme на id выключить `TENANT_ALLOW_SLUG`.
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
