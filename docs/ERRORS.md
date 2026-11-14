# Коды ошибок

Файл генерируется из `src/infra/errors/error-codes.ts` командой `npm run openapi`; руками не правится.
Форма ответа, правила и `platform_misconfigured`: `docs/API.md`, «Ошибки».

Коды не переименовываются и не используются повторно. Новый смысл получает новый код, старый
помечается устаревшим (зачёркнут, указана замена) и больше не отдаётся.

| Код | HTTP | Когда | Дополнительно |
|---|---|---|---|
| `bad_request` | 400 | Запрос не разобран, а точного кода нет | — |
| `invalid_body` | 400 | Тело запроса не JSON или обрезано | — |
| `validation_error` | 400 | Тело, query или файл не прошли проверку; поля в `fields` | `fields` |
| `unauthorized` | 401 | Нет токена владельца, он неверен или пользователь отключён; неверный секрет вебхука | — |
| `forbidden` | 403 | Действие недоступно этому пользователю (нет заведения, не администратор платформы) | — |
| `not_found` | 404 | Ресурс не найден или принадлежит другому заведению; неизвестный маршрут | — |
| `payload_too_large` | 413 | Файл или тело больше лимита | `details.maxBytes` |
| `unsupported_media_type` | 415 | Неподдерживаемый `Content-Type` | — |
| `rate_limited` | 429 | Превышен лимит запросов (по IP, номеру или пользователю) | `retryAfter` |
| `internal_error` | 500 | Непредвиденная ошибка сервера; подробности только в логе по `requestId` | — |
| `unavailable` | 503 | Временный сбой (очередь, база); повторить позже | — |
| `platform_misconfigured` | 503 | Функция выключена настройкой платформы (не заведения); `details.feature`: `telegram_bot`, `delivery_link`, `sms`, `domains`, `payments`, `translation`, `order_notifications` | `details.feature` |
| `tenant_required` | 400 | Клиентский запрос без заголовка `X-Tenant-Id` | — |
| `tenant_not_found` | 404 | Нет активного заведения с таким id (или передан slug вместо id) | — |
| `tenant_inactive` | 403 | Заведение отключено | — |
| `tenant_mismatch` | 403 | Токен клиента выдан другим заведением | — |
| `invalid_phone` | 400 | Номер не `+998XXXXXXXXX` | — |
| `invalid_code` | 400 | Неверный код или код не той длины | — |
| `code_expired` | 400 | Код истёк или уже использован | — |
| `too_many_attempts` | 429 | Исчерпаны попытки ввода кода (код сгорает) или вход владельца заблокирован | `retryAfter` |
| `invalid_name` | 400 | Имя клиента пустое или слишком длинное | — |
| `language_not_supported` | 422 | Язык клиента не ru, uz или en либо не включён у заведения | — |
| `registration_expired` | 400 | Заявки нет: истекла, уже подтверждена или неизвестный id | — |
| `invalid_registration_token` | 400 | Токен шага с именем неверен или истёк | — |
| `invalid_refresh_token` | 401 | Refresh-токен неизвестен, отозван, истёк или использован повторно | — |
| `missing_token` | 401 | Клиентский маршрут без `Authorization: Bearer` | — |
| `token_expired` | 401 | Access-токен клиента истёк (обновить через refresh) | — |
| `invalid_token` | 401 | Access-токен клиента неверен или сессия отозвана | — |
| `customer_blocked` | 403 | Клиент заблокирован заведением | — |
| `sms_unavailable` | 503 | Провайдер SMS не ответил или отказал; лимиты отправки откатываются | — |
| `telegram_unavailable` | 503 | У заведения нет бота или бот не смог доставить код; предложить SMS | — |
| `invalid_telegram_data` | 401 | `initData` Mini App не прошла проверку подписи или устарела | — |
| `invalid_credentials` | 401 | Вход владельца: неверный телефон или пароль (ответ одинаковый) | — |
| `phone_taken` | 409 | Номер уже принадлежит подтверждённому владельцу | — |
| `wrong_password` | 400 | Смена пароля: текущий пароль неверен | — |
| `invalid_address` | 400 | Адрес клиента не прошёл проверку | — |
| `address_not_found` | 404 | Адреса нет у этого клиента | — |
| `address_limit_reached` | 409 | У клиента уже максимум сохранённых адресов | — |
| `invalid_order` | 400 | Заказ не собирается (пустой, неверное количество, нет адреса или филиала); `details.items` по позициям | `details.items` |
| `invalid_modifiers` | 422 | Неизвестная группа или вариант допа, повтор, не выбран обязательный | `details.items` |
| `item_unavailable` | 409 | Блюда нет или оно скрыто; `details.items` | `details.items` |
| `price_changed` | 409 | `expectedTotal` не совпал с суммой по ценам из базы; новые цены в `details` | `details.items`, `details.subtotal`, `details.deliveryFee`, `details.total` |
| `delivery_fee_changed` | 409 | `expectedDeliveryFee` не совпал с ценой доставки по текущим правилам филиала; новая цена в `details` | `details.deliveryFee`, `details.freeFrom`, `details.minOrder`, `details.total` |
| `min_order_not_reached` | 422 | Сумма без доставки меньше минимальной; `details.minAmount`, `details.shortBy` (сколько не хватает) | `details.minAmount`, `details.shortBy` |
| `out_of_delivery_zone` | 422 | Ни один филиал с правилами доставки не доставляет на этот адрес (вне зон и дальше максимального расстояния) или у адреса нет координат | — |
| `fulfillment_unavailable` | 422 | Тип получения выключен у заведения | — |
| `branch_closed` | 409 | Филиал закрыт сейчас; `details.opensAt`: ближайшее открытие, ISO 8601 с датой и поясом филиала (как в `GET /branches`), `null`, если в 7 дней открытий нет | `details.opensAt` |
| `branch_hours_not_set` | 422 | У филиала нет расписания | — |
| `payment_method_unavailable` | 422 | Способ оплаты не подключён у заведения | — |
| `idempotency_key_required` | 400 | `POST /orders` без заголовка `Idempotency-Key` | — |
| `idempotency_key_reused` | 409 | Тот же ключ с другим телом | — |
| `too_many_active_orders` | 429 | У клиента слишком много незавершённых заказов | `retryAfter` |
| `cancel_not_allowed` | 409 | Клиент отменяет заказ, который уже принят | — |
| `payment_not_retryable` | 409 | Повтор оплаты для заказа не в том статусе | — |
| `order_not_found` | 404 | Заказа нет у этого клиента или заведения | — |
| `order_status_conflict` | 409 | Владелец: действие с заказом недоступно в его статусе; `details.status` | `details.status` |
| ~~`delivery_unavailable_no_zone`~~ устарел → `delivery_not_configured` | 422 | У заведения не нарисована зона доставки | — |
| `delivery_not_configured` | 422 | Ни у одного филиала с доставкой нет правил стоимости (зон или правила по расстоянию) | — |
| `ordering_channel_disabled` | 422 | Канал «доставка» выключен | — |
| `ordering_not_published` | 422 | Канал включён, но не опубликован | — |
| `settings_missing` | 500 | Нет строки настроек заведения (ошибка данных, не клиента) | — |
| `invalid_settings` | 400 | Настройки заведения противоречат друг другу; поля в `fields` | `fields` |
| `invalid_slug` | 400 | Slug не по правилам (формат, UUID, зарезервирован) | — |
| `slug_taken` | 409 | Slug занят другим заведением | — |
| `telegram_bot_required` | 422 | Режим `miniapp`/`both` без подключённого бота | — |
| `miniapp_required` | 403 | Режим `miniapp`: заказ или вход гостя без заголовка `X-Telegram-Init-Data`; открыть заведение в Telegram | — |
| `miniapp_init_data_invalid` | 403 | Режимы `miniapp`/`both`: `X-Telegram-Init-Data` не подписан ботом заведения или устарел; переоткрыть Mini App | — |
| `publication_incomplete` | 409 | Публикация: не выполнены пункты чеклиста; `details.missing` | `details.missing` |
| `invalid_bot_token` | 400 | Токен бота не по формату или Telegram его не принял | — |
| `bot_already_connected` | 409 | Бот уже подключён к другому заведению | — |
| `bot_not_connected` | 404 | Операция с профилем бота без подключённого бота | — |
| `webhook_setup_failed` | 400 | Telegram не принял адрес вебхука бота | — |
| ~~`webhook_url_not_https`~~ устарел → `platform_misconfigured` | 400 | Адрес API платформы не https | — |
| `invalid_host` | 400 | Домен не является именем хоста; поле в `fields` | `fields` |
| `reserved_host` | 400 | IP-адрес или зарезервированная зона; поле в `fields` | `fields` |
| `platform_host` | 400 | Домен платформы или любой хост под ним; поле в `fields` | `fields` |
| `domain_taken` | 409 | Домен подтверждён другим заведением | — |
| `domain_not_found` | 404 | Домена нет у этого заведения | — |
| `domain_already_added` | 409 | Домен уже добавлен этим заведением | — |
| `domain_limit_reached` | 422 | У заведения уже максимум доменов; `details.limit` | `details.limit` |
| `domain_verification_failed` | 422 | Проверка TXT не прошла; `details.reason`: `record_not_found` \| `token_mismatch` \| `dns_error`, `details.record` ожидаемая запись | `details.reason`, `details.record` |
| `telegram_request_failed` | 502 | Bot API отказал в применении пункта профиля бота (`code` пункта в `lastSync`); текст ответа только в логе | — |
| `translation_failed` | 502 | Сервис перевода не ответил или ответил не по формату | — |
| ~~`translation_unavailable`~~ устарел → `platform_misconfigured` | 503 | Перевод не настроен на платформе | — |
