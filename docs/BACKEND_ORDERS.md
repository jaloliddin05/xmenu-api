# Бэкенд: филиалы, меню, заказы, платежи

Что добавлено, как это запустить и что **ещё не проверено на реальных сервисах**.
Контракт для фронтенда — `ORDERS_API.md` и `BRANCHES_API.md` (лежат рядом).

## Модули

| Модуль | Что делает |
|---|---|
| `branch` | `GET /branches` (публичный) + CRUD филиалов, расписание, исключения (`/branch`). `isOpen`/`opensAt`/`hours` считаются на сервере одной функцией — той же, что проверяет `POST /orders` |
| `menu` | `GET /menu` (публичный): категории → блюда → группы модификаторов, язык по `?lang`/`Accept-Language` |
| `order` | клиентский API `/orders*`, `GET /checkout-config`; панель ресторана `/order*`, `/order-settings`; Telegram-кнопки `/telegram/orders/webhook` |
| `order` (ядро) | `OrderTransitionService` — **единственный** путь смены статуса: автомат состояний + оптимистичная блокировка (`version`) + журнал `order_status_event`; очереди; уведомления |
| `payment` | Click Shop API (`/payments/click/:tenantId/prepare|complete`), Payme Merchant API (`/payments/payme/:tenantId`), ключи тенанта (`/payment-provider`), возвраты |

Зависимости модулей без циклов: `payment → order-core ← order`, `order → payment`.

## Миграция

```bash
npx prisma migrate deploy   # 20261010090000_branches_orders_payments
```
Исходники схемы лежат в `src/modules/*/models/*.prisma`; `prisma/schema.prisma`
собирается из них (`generate-schema`) — в архиве он уже пересобран.
Миграция добавляет: `branch*`, `customer_order*`, `order_status_event`, `order_payment`,
`organization_order_settings`, `organization_payment_provider`, колонки
`organization.order_seq`, `additional_product_group.min_selected/max_selected`
и CHECK-ограничения (сумма заказа = subtotal + fee − discount, формат часов работы,
день недели 1..7). Проверена на чистой PostgreSQL 16 вместе со всеми прежними миграциями.

## Переменные окружения

| Переменная | Обязательна | Назначение |
|---|---|---|
| `PAYMENT_CONFIG_KEY` | для онлайн-оплаты | 32 байта (64 hex или base64): ключ AES-256-GCM, которым шифруются ключи Click/Payme в БД. `openssl rand -hex 32`. **Потеря ключа = все тенанты вводят ключи заново** |
| `TELEGRAM_BOT_TOKEN` | для уведомлений | бот: сообщения в группу филиала и клиенту. Для отдельного бота ресторанов — `TELEGRAM_ORDERS_BOT_TOKEN` |
| `TELEGRAM_WEBHOOK_SECRET` | для кнопок | `secret_token` webhook'а; без него эндпоинт отвечает 503 |
| `PUBLIC_API_URL` | да | публичный адрес API: абсолютные URL картинок меню, адреса вебхуков в `GET /payment-provider` |
| `PUBLIC_FILES_URL` | нет | если картинки отдаются с другого домена/CDN |
| `MINIAPP_URL` / `MINIAPP_RETURN_URL` | желательно | куда Click/Payme возвращают клиента (`…/order/{orderId}`) |
| `OPS_CHAT_ID` (или `XMENU_CHAT_ID`) | желательно | чат команды: ручной возврат Payme, провал возврата Click, у филиала нет телефона для SMS эскалации |
| `REDIS_URL` или `REDIS_HOST/PORT/PASSWORD` | да | очереди; раньше `bull.config` читал только host/port — с паролем очереди не работали |
| `ORDER_QUEUES=off` | нет | локально без Redis: эскалация и авто-отмена не работают (срок оплаты всё равно проверяется при чтении заказа) |

## Подключение нового ресторана (по шагам)

1. `POST /branch` — филиал (адрес, координаты, `phone` для SMS, `telegramChatId`).
2. `PUT /branch/:id/working-hours` — расписание.
3. `PUT /order-settings` — цена доставки, минимум, ETA, таймауты, `deliveryZone` ([[lat,lng],…]).
4. Telegram: бот добавить в группу филиала, id группы → `telegramChatId`. Один раз на платформу:
   ```
   POST https://api.telegram.org/bot<TOKEN>/setWebhook
   { "url": "<API>/telegram/orders/webhook", "secret_token": "<TELEGRAM_WEBHOOK_SECRET>", "allowed_updates": ["callback_query"] }
   ```
5. Платежи: `PUT /payment-provider/click` `{config:{merchantId,serviceId,merchantUserId,secretKey}}`,
   `PUT /payment-provider/payme` `{config:{merchantId,key}}`. `GET /payment-provider` вернёт
   адреса, которые нужно вписать в кабинеты Click (Prepare/Complete) и Payme (Endpoint).
6. Во фронтенде: `NEXT_PUBLIC_ORDERS_MOCK=false`, `NEXT_PUBLIC_BRANCHES_MOCK=false`,
   `NEXT_PUBLIC_MENU_MOCK=false`, `NEXT_PUBLIC_IMAGES_ORIGIN=<PUBLIC_API_URL>`.

## Жизненный цикл заказа

```
cash:    pending_acceptance → accepted → preparing → on_the_way | ready → completed
online:  awaiting_payment → (webhook) pending_acceptance → …    ┐
                         → payment_failed ↔ awaiting_payment     │ отмена: customer / restaurant / system
cancelled — из awaiting_payment, payment_failed, pending_acceptance, accepted (клиент); дальше только ресторан
```
Правила — `order/domain/order-state-machine.ts` (с тестами). Оплату подтверждает **только** webhook
провайдера (актор `payment`); клиент, ресторан и система сделать заказ «оплаченным» не могут.

**Эскалация** (от момента `pending_acceptance`, BullMQ `order-escalation`):
45 с — повтор в Telegram → 120 с — SMS на телефон филиала → 300 с (`acceptance_timeout_seconds`) —
авто-отмена и возврат. Робозвонка в цепочке нет; задачи `esc-call`, поставленные до его удаления, молча
пропускаются. Каждая задача перечитывает статус и ничего не делает, если заказ уже принят/отменён.

**Возвраты** (очередь `order-refunds`, 5 попыток с экспоненциальной паузой):
Click — автоматически через Merchant API (reversal). Payme — мерчант вернуть деньги сам **не может**
(возврат инициирует Payme через `CancelTransaction`): заказ остаётся `refund_pending`,
в ops-чат уходит просьба вернуть вручную.

## Безопасность

* Tenant и клиент берутся из токена и `X-Tenant-Id` (id организации), не из тела запроса; чужой заказ = `order_not_found`.
* Цены, названия, доступность и правила модификаторов — только из БД; от клиента приходят id и количества.
* Вебхуки Click/Payme: URL содержит id тенанта (не меняется при смене slug), подпись проверяется ключом **этого** тенанта
  (`timingSafeEqual`); заказ ищется только внутри тенанта. Payme: неверный тенант и неверный пароль
  дают один и тот же ответ.
* Telegram-кнопки: secret-token + проверка, что нажали в группе **этого** филиала.
* Строка заказа блокируется (`SELECT … FOR UPDATE`) при оплате/отмене, поэтому «деньги списаны,
  а заказ отменён» невозможно: комплит после отмены отвечает `-9` (Click) / `-31008` (Payme).
* Ключи провайдеров шифруются (AES-256-GCM), в ответах API не возвращаются.
* Весь текст в Telegram экранируется (`parse_mode=HTML`).

## Что проверено, а что нет

**Проверено автоматически (250 тестов `jest`, `tsc` без ошибок):** график работы и ночные смены;
автомат статусов; расчёт и валидация заказа по БД (модификаторы, min/max, недоступные блюда);
протоколы Click и Payme на in-memory хранилище (подписи, идемпотентность, таймаут 12 ч, гонка
«отменили между Prepare и Complete», возвраты); шифрование ключей; сообщения Telegram и экранирование;
сборка DI-графа модулей. Миграции и SQL-правила (CHECK, уникальные индексы, `FOR UPDATE`, каскады)
прогнаны на реальной PostgreSQL 16.

**НЕ проверено (в моей среде нет этого доступа):**
1. **Prisma-запросы не выполнялись** — движок Prisma недоступен офлайн; код проверен компилятором
   по сгенерированным типам. Прогоните `POST /orders` end-to-end на стенде.
2. **Click и Payme не вызывались.** Протоколы написаны по документации; проверьте в sandbox обоих
   кабинетов. Особенно: reversal-эндпоинт Click и заголовок `Auth`; параметры `cr`/`c`/`l` в ссылке Payme.
3. **Telegram** не вызывался (webhook, `editMessageText`, личные сообщения клиенту).
4. Нагрузочные сценарии (много одновременных заказов на один тенант).

## Не реализовано

* Интеграция с POS (iiko/Jowi/Poster) — первый приоритет в вашей схеме уведомлений; сейчас Telegram + SMS.
* Web Push / WebSocket для браузерной админки (панель пока опрашивает `GET /order`).
* Фискальные чеки Payme (`detail`) и онлайн-кассы.
* Меню/остатки по филиалам; заказ ко времени; промокоды и скидки (поле `discount` есть, всегда 0).
* Язык уведомлений клиенту — только русский (у `customer` нет поля языка).
* Ротация `PAYMENT_CONFIG_KEY`.
* Rate limit на `POST /orders` (есть только лимит активных заказов на клиента).
* IP-allowlist для вебхуков Click/Payme (стоит настроить на уровне nginx/WAF).

## Замечание о существующем коде

Эндпоинты панели для групп модификаторов (`product/additional-product*`) при `product_id`
делают `connect`, а `update`/`delete` — по одному только `id`, без проверки принадлежности организации
сотрудника (slug используется лишь для ревалидации). Я это не менял, но стоит закрыть: иначе сотрудник
одного ресторана может править группы и привязывать их к блюдам другого. Заказы от этого защищены —
цены считаются только по блюдам своего тенанта.
