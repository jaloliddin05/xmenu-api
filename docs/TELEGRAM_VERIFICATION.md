# Подтверждение номера через Telegram

Альтернатива SMS-коду: клиент подтверждает номер через бота **своего заведения**. SMS остаётся основным способом;
Telegram доступен, когда заведение подключило бота. Пока нет договора с SMS-провайдером, это единственный реальный
способ подтверждения без тестовой группы.

Само подтверждение номера входом через `initData` не является: в режиме Mini App `initData` привязывает сессию к
Telegram-пользователю (защита от пересылки ссылки). Отдельно `POST /auth/customer/login` с `initData` впускает клиента,
к которому этот Telegram-пользователь уже привязан. Режим доставки заведения (`site`, `miniapp`, `both`) решает, нужен ли
`initData` для входа и заказа: раздел «Mini App и режимы доставки».

Код: `src/modules/telegram/` (боты заведений), `auth/services/telegram-verification.service.ts`,
`auth/controllers/telegram-bot-webhook.controller.ts`. Сессии в Redis (`tgv:*`).

## Подключение бота заведением (владелец, `Authorization: Bearer`)

| Метод | Путь | Что делает |
|---|---|---|
| `GET` | `/telegram-bot` | Статус: `{ connected, username, link, isEnabled }`. Токен и адрес вебхука (в нём внутренний ключ бота) не возвращаются; адрес пишется в лог сервера при подключении |
| `PUT` | `/telegram-bot` | Тело `{ "token": "123456:AA..." }`. Проверяет токен через `getMe`, регистрирует webhook с секретом, сохраняет токен зашифрованным (AES-256-GCM, `PAYMENT_CONFIG_KEY`) |
| `DELETE` | `/telegram-bot` | Снимает webhook, возвращает стандартную кнопку меню и удаляет бота. 200 `{ connected: false, leftOnBot: ["name", "description", "shortDescription", "commands"] }`: это остаётся у бота в Telegram (бот принадлежит владельцу, его настройки не сбрасываем; меняются в @BotFather). Бота не было: `leftOnBot: []` |

Ошибки `PUT` (общий формат, `docs/API.md`, «Ошибки»): `invalid_bot_token` (400), `webhook_setup_failed` (400, ничего
не сохранено), `bot_already_connected` (409, бот уже у другого заведения), `platform_misconfigured` (503,
`details.feature: telegram_bot`: на сервере `PUBLIC_API_URL` не https или нет годного `PAYMENT_CONFIG_KEY`).

Webhook: `POST /telegram/bot/{id строки бота}/webhook` (в OpenAPI скрыт). Адрес не зависит от slug и не меняется
при повторном подключении того же заведения; секрет каждый раз новый. Смена бота снимает webhook со старого.
В БД хранится только sha256 секрета (`organization_telegram_bot.webhook_secret_hash`), сам секрет знает только
Telegram; заголовок хешируется и сравнивается с хешем за константное время.

Обработка асинхронная: вебхук проверяет секрет, отмечает `update_id` (Redis `tgv:upd:*`, 1 час) и кладёт
`{ botKey, update }` в очередь BullMQ `telegram-update`, после чего сразу отвечает `200 {"ok":true}`. Повтор того же
`update_id` получает 200 и в очередь не попадает. Ответы бота (`sendMessage`), выдача кода и смена статуса сессии
происходят в обработчике очереди (`telegram-update.processor.ts`), поэтому медленный Telegram ответ вебхука не держит.
Обработчик заново читает бота по `botKey` (отключён → апдейт пропускается), 3 попытки с паузой от 5 с; в логах только
id бота и апдейта и текст ошибки. Ошибки Telegram внутри обработки не повторяются (гасятся и пишутся в лог), повтор
бывает только при сбое Redis или БД. Не удалось поставить в очередь → отметка снимается, ответ 503, Telegram повторит.
Токена в задаче нет; задача с ошибкой хранится сутки (в апдейте может быть телефон).

Что должна показывать админка: инструкция «создайте бота в @BotFather, вставьте токен», затем статус и ссылку на бота.
Webhook и секрет ставятся автоматически, руками настраивать ничего не нужно.

## Клиентский контур (`X-Tenant-Id: <id организации>`)

Если у заведения нет подключённого бота, `telegram/start` отвечает `503 telegram_unavailable`: показывай только SMS.
Если токен бота не расшифровывается (сменён или потерян `PAYMENT_CONFIG_KEY`, значение повреждено), `telegram/start`,
проверка `initData` и вебхук бота отвечают `503 platform_misconfigured` (`feature: telegram_bot`), а
`GET /auth/customer/methods` и `channels.auth` отдают `telegram: false`. Какие способы показать в шторке, клиент
узнаёт из `GET /auth/customer/methods` (без кэша) при её открытии.
Заранее это видно в `GET /tenant/config`: `channels.auth.telegram` (бот подключён и включён). Подключение и отключение
бота ставит ревалидацию `route: 'channels'`, чтобы кэш фронтов не держал старый признак.

### `POST /auth/customer/telegram/start`

Тело: `{ phone?: string, initData?: string }`.

- **С `initData`** (внутри Mini App, в теле или в заголовке `X-Telegram-Init-Data`): режим `instant`. `phone`
  необязателен; если передан, контакт должен с ним совпасть. `initData` проверяется токеном бота заведения; неверная
  подпись в теле → `401 invalid_telegram_data`, в заголовке (режимы `miniapp`, `both`) → `403 miniapp_init_data_invalid`.
- **Без `initData`** (сайт): режим `code`. `phone` обязателен (`+998XXXXXXXXX`), иначе `400 invalid_phone`.

Ответ: `{ sessionId, mode: "instant" | "code", botUsername, deepLink, expiresIn }`. `expiresIn` в секундах
(`TELEGRAM_VERIFY_TTL_SECONDS`, по умолчанию 300). `deepLink` = `https://t.me/{botUsername}?start={sessionId}`.

### `POST /auth/customer/telegram/status`

Тело: `{ sessionId }`. Опрашивай раз в 2 секунды, пока `expiresIn` не истёк. Ответы:

| `status` | Значение | Что делать клиенту |
|---|---|---|
| `pending` | Ждём, пока пользователь поделится контактом | Продолжать опрос |
| `code_sent` (+ `phone`, `codeLength`) | Режим `code`: код отправлен в чат с ботом; `codeLength` — число цифр (как в `otp/request`) | Показать поле кода на `codeLength` цифр, завершить через `POST /auth/customer/otp/verify` |
| `verified` (+ результат входа) | Режим `instant`: номер подтверждён. Дальше поля как в ответе `otp/verify`: `isNewUser`, токены и `user` или `registrationToken` | Войти или перейти к шагу «имя» (`register` с тем же `initData`). Результат выдаётся **один раз** |
| `expired` | Сессия истекла, чужая (другой тенант) или уже использована | Начать заново |

## Язык сообщений бота

Ответы бота выбирают язык по `language_code` Telegram-пользователя (`uz` и `en`, иначе русский); тексты
`telegram-verification.messages.ts` одинаковы по смыслу на трёх языках, узбекский латиницей (тест на полноту ключей и
отсутствие кириллицы в `uz`/`en`). Это язык диалога в чате и не зависит от `customer.language`, который задаётся из
языка запроса приложения (см. `docs/API.md`, «Язык клиента»).

## Сценарии

**Mini App (`instant`):**
1. `telegram/start` с `initData`, затем `Telegram.WebApp.requestContact()`; если не поддерживается, открыть `deepLink`.
2. Пользователь делится контактом; бот отвечает «Номер подтверждён».
3. Опрос `telegram/status` вернёт `verified` с готовым входом. Telegram-пользователь привязывается к клиенту. Новый
   номер получает `registrationToken`, в нём уже лежит Telegram-пользователь: `register` (имя) привязывает его без
   повторного `initData`.
4. Следующие открытия Mini App: `POST /auth/customer/login { initData }` впускает сразу, без телефона.

**Сайт (`code`):**
1. Пользователь вводит телефон; `telegram/start` с `phone`; открыть `deepLink` (ссылка на бота).
2. В боте кнопка «Поделиться номером». Номер должен совпасть с введённым.
3. Бот присылает код в чат; `telegram/status` вернёт `code_sent`.
4. Пользователь вводит код; `POST /auth/customer/otp/verify { phone, code }`, как с SMS (длина кода `OTP_LENGTH`).

Повторная отправка кода: пользователь снова делится контактом в боте (действуют те же лимиты, что и у SMS).

## Mini App и режимы доставки

Режим `channels.delivery.mode` заведения (владелец выбирает в `PUT /organization/:id/channels`, `miniapp` и `both`
требуют бота):

- `site`: Mini App нет. Кнопка меню бота стандартная (Telegram), `/start` отвечает приветствием без кнопки. Вход и
  заказы как обычно, заголовок `X-Telegram-Init-Data` не проверяется.
- `miniapp`: заказать и войти можно только внутри Mini App. Шаги входа (`otp/request`, `otp/verify`, `register`,
  `telegram/start`, `login`) и `POST /orders` требуют заголовка `X-Telegram-Init-Data` с `Telegram.WebApp.initData`,
  подписанным ботом заведения и не старше `TELEGRAM_INITDATA_MAX_AGE_SECONDS` (по умолчанию сутки). Нет заголовка →
  `403 miniapp_required`; поддельный, просроченный или подписанный другим ботом → `403 miniapp_init_data_invalid`.
- `both`: сайт и Mini App. Без заголовка всё как в `site`; пришедший заголовок проверяется так же, как в `miniapp`, и
  годится для входа и привязки Telegram.
- Бот удалён при режиме `miniapp`/`both` (режим остаётся): `503 telegram_unavailable` на шагах входа и заказе.

Кнопка меню бота в `miniapp` и `both`: `web_app` на адрес сайта доставки заведения (`https://<primaryDomain>`, иначе
`DELIVERY_URL_TEMPLATE`); в `site` стандартная. Бэкенд ставит её сам при подключении бота, смене режима, смене slug,
подтверждении и удалении подтверждённого домена (`TelegramBotProfileService.syncMenuButton`: каждый раз полное нужное
состояние, ошибки Telegram только в лог и в `lastSync`). `/start` без параметра в `miniapp` и `both` отвечает
приветствием с кнопкой «Открыть меню» (`web_app`, тот же адрес).

Для клиента в `GET /tenant/config`: `channels.delivery.mode`, `channels.delivery.miniApp` (режим `miniapp`/`both` и бот
работает) и `channels.delivery.botUsername` (для ссылки `https://t.me/<botUsername>`, только при `miniApp`). Коды и таблица:
`API.md`, «Mini App и режимы доставки».

## Защита

- Контакт принимается только если `contact.user_id` совпадает с отправителем: пересланный чужой контакт ничего не подтверждает.
- Режим `instant`: сессия привязана к Telegram-пользователю из подписанного `initData`. Ссылка, отправленная другому
  человеку, сессию не захватит.
- Режим `code`: код уходит только в аккаунт Telegram, номер которого совпал с запрошенным.
- Код выдаёт `CustomerOtpService.issue()`: хранится как хеш, одноразовый, с лимитом попыток; лимиты по телефону общие
  с SMS (нельзя обойти, чередуя каналы). Лимит по IP у кода из бота не применяется (вебхук IP клиента не знает).
- Лимиты `start`: 20 в час на IP, 5 в час на телефон, 10 в час на Telegram-пользователя. `status`: 200 опросов на
  сессию за 5 минут, 600 на IP за 15 минут.
- Webhook проверяет `X-Telegram-Bot-Api-Secret-Token` (sha256 заголовка против хеша в БД, за константное время),
  каждое `update_id` ставится в очередь один раз, принимаются только личные сообщения не от ботов. Адрес содержит id бота, а не slug.
- Максимум 3 попытки отправки контакта на сессию; сессия живёт `TELEGRAM_VERIFY_TTL_SECONDS` (300 с).
- Поддерживаются только номера Узбекистана (`+998`).
- Токен бота не логируется: ошибки Telegram пишутся только их описанием.

## Фейковый Telegram (тесты и e2e)

Все вызовы Bot API (боты заведений, уведомления о заказах, тестовая группа OTP) идут на `TELEGRAM_API_BASE_URL`
(по умолчанию `https://api.telegram.org`): `{base}/bot{token}/{method}`, тело JSON. В production API не стартует с
другим значением; вне production значение должно быть http(s)-адресом, при старте пишется предупреждение.

Как e2e подставляют фейк:
1. Поднять HTTP-сервер (например, сток `xmenu-e2e/scripts/sink.mjs`) и дать бэкенду
   `TELEGRAM_API_BASE_URL=http://127.0.0.1:<порт>`. Запросы идут обычным HTTP, без `CONNECT`, поэтому их тело видно.
2. Отвечать на `POST /bot<token>/<method>` как Telegram, `{ "ok": true, "result": … }`: `getMe` →
   `{ "id": 123456789, "is_bot": true, "username": "e2e_bot" }`; `setWebhook`, `deleteWebhook`, `setMyName`,
   `setMyDescription`, `setMyShortDescription`, `setMyCommands`, `setChatMenuButton` → `true`; `sendMessage` →
   `{ "message_id": 1, "chat": { "id": <chat_id из тела> } }`. Ошибку изображать `{ "ok": false, "error_code": 400,
   "description": "…" }`, медленный Telegram — задержкой ответа. Каждый запрос записывать (метод и тело).
3. `PUT /telegram-bot` требует https `PUBLIC_API_URL`; адрес вебхука уходит только фейку в `setWebhook`, сам Telegram
   его не вызывает, поэтому достаточно любого `https://…` в `PUBLIC_API_URL` стека.
4. Секрет вебхука тест берёт из тела `setWebhook` (`secret_token`): в БД только хеш. `botKey` — из `url` того же тела
   (`…/telegram/bot/<botKey>/webhook`); в ответах API адреса вебхука нет.
5. Апдейты тест шлёт сам: `POST /telegram/bot/<botKey>/webhook` с заголовком `X-Telegram-Bot-Api-Secret-Token` и
   телом `{ update_id, message: { chat: { id, type: "private" }, from: { id }, text: "/start <sessionId>" } }`, затем
   `{ …, message: { …, contact: { phone_number, user_id: <from.id> } } }`.
6. Обработка асинхронная: ответ вебхука ничего не говорит о результате. Ждать нужного `sendMessage` в журнале фейка
   (код — в его `text`) или `code_sent` в `telegram/status`.
Токены в e2e фиктивные: они видны в пути запросов к фейку и в его журнале.

## Не проверено на реальном Telegram

Логика покрыта тестами с подменой Telegram, но реальный бот не подключался. Перед запуском проверь вручную:
1. `PUT /telegram-bot` на публичном https-адресе (`PUBLIC_API_URL`): `setWebhook` проходит, обновления приходят на
   `/telegram/bot/{id}/webhook` с заголовком секрета; повторное подключение, смена бота и `DELETE /telegram-bot`.
2. Mini App: приходит ли после `requestContact()` в бота обычное сообщение `contact` с `user_id` отправителя.
3. Сайт: цепочка `deepLink` → `/start` → кнопка контакта → код в чате → `otp/verify`.
4. Автонастройка (`PUT /telegram-bot`, `PUT /telegram-bot/profile`, `POST /telegram-bot/sync`, см. `API.md`): имя, описания и
   команда `/start` реально появились у бота (по языкам), кнопка меню открывает `https://{slug}.xmenu.uz` как Mini App,
   `DELETE /telegram-bot` вернул стандартную кнопку, смена slug перенастроила кнопку; ответ Telegram на частую смену имени.
5. Режимы доставки: смена `site` ↔ `miniapp` меняет кнопку меню у клиентов Telegram (кэш клиента Telegram может держать
   старую кнопку до перезапуска чата); кнопка «Открыть меню» в `/start` открывает Mini App.
6. `initData` от настоящего клиента Telegram (iOS, Android, Desktop) проходит проверку подписи и срока; заголовок
   `X-Telegram-Init-Data` доходит через nginx (размер заголовка).
7. Mini App на своём домене заведения (`https://<primaryDomain>`): Telegram открывает его как Web App по кнопке меню.

## Известные ограничения и следующие шаги

- Уведомления о заказах (кнопки в группах филиалов) пока идут через платформенного бота (`TELEGRAM_BOT_TOKEN` /
  `TELEGRAM_ORDERS_BOT_TOKEN`), не через бота заведения.
- Заведение без своего бота: `initData` в теле (`login`, `otp/verify`, `register`) проверяется токеном платформенного
  бота (как раньше); заголовок `X-Telegram-Init-Data` проверяется только ботом заведения.
- Заказ в режиме `miniapp` не сверяет Telegram-пользователя из `initData` с привязанным к клиенту: проверяется только,
  что запрос пришёл из Mini App заведения.
