# Контракт API заказов (клиент → бэкенд)

Фронт уже вызывает эти эндпоинты через `src/features/orders/lib/ordersApi.js`.
Пока `NEXT_PUBLIC_ORDERS_MOCK` не `false`, вместо них работает эмулятор
`ordersMock.js` — он ведёт себя ровно так, как описано ниже, и служит
исполняемой версией этой спецификации.

Общее: заголовки `Authorization: Bearer`, `X-Tenant-Id` (как у остальных
customer-эндпоинтов). Ошибки — общий формат API:
`{ "code", "message", "status", "retryAfter?", "details?", "requestId" }` (общая форма, `docs/API.md`, «Ошибки»).
Все эндпоинты — только для авторизованного клиента; чужой заказ = `404`.

## Эндпоинты

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/orders` | создать заказ (заголовок `Idempotency-Key` обязателен) |
| GET | `/orders/:id` | один заказ (его опрашивает экран отслеживания) |
| GET | `/orders` | история, новые первыми |
| GET | `/menu` | меню (публичный; язык из `?lang=`/`Accept-Language` среди языков заведения, иначе язык заведения; валюта из настроек заведения) |
| GET | `/checkout-config` | минимум самовывоза и способы оплаты для доставки и самовывоза (публичный) |
| GET | `/delivery/quote?lat=&lng=&subtotal=` | цена и минимум доставки на адрес, филиал или причина недоступности (публичный, `API.md`, «Стоимость доставки») |
| GET | `/orders?status=active` | только незавершённые (не `completed`/`cancelled`) — для плашки «активный заказ» на главной; если параметр не поддержан, клиент отфильтрует сам |
| POST | `/orders/:id/cancel` | отмена клиентом |
| POST | `/orders/:id/payment/retry` | новая ссылка оплаты после `payment_failed` |

Webhook'и Click/Payme переводят заказ `awaiting_payment → pending_acceptance`
(оплата) или `→ payment_failed` (отказ/истечение). Клиент о них узнаёт
только опросом `GET /orders/:id`.

## POST /orders

```json
{
  "fulfillmentMode": "delivery",
  "branchId": "main",
  "addressId": "uuid",
  "phone": "+998998168667",
  "comment": "не звонить",
  "paymentMethod": "cash",
  "cashChangeFrom": 200000,
  "items": [
    { "itemId": "manti-lamb", "quantity": 2,
      "modifiers": [ { "groupId": "toppings", "optionIds": ["katyk-1", "lazjon-1"] } ] }
  ],
  "expectedDeliveryFee": 15000,
  "expectedTotal": 112000
}
```

* Цен в запросе нет. Сервер считает всё сам: цена блюда + цены выбранных
  опций, цена доставки по правилам филиала (только delivery, `API.md`, «Стоимость доставки»), скидки.
* Одно блюдо может идти несколькими элементами `items` с разными
  `modifiers` — это разные позиции заказа.
* Сервер обязан проверить: блюдо/опции существуют и доступны; для каждой
  группы выполнены `required/min/max`; `quantity` 1..50 в строке и не больше 50 одного блюда
  на весь заказ (строки с разными модификаторами суммируются); филиал открыт;
  адрес принадлежит клиенту, и какой-то открытый филиал на него доставляет; минимальная сумма;
  способ оплаты включён у тенанта.
* `expectedDeliveryFee` — цена доставки, которую клиент видел в корзине (`deliveryFee` из `GET /delivery/quote`).
  Правила изменились → `409 delivery_fee_changed` с новой ценой; клиент показывает её и просит подтвердить.
* `expectedTotal` — сумма, которую видел клиент. Не совпала → `409 price_changed`.
* `cashChangeFrom` — необязательно, только при `paymentMethod: cash`: с какой суммы нужна сдача, не меньше суммы к
  оплате (с доставкой). Иначе `400 validation_error`, поле `cashChangeFrom` (`cash_only` или `below_total`).
* `branchId`: id из `GET /branches` (см. `BRANCHES_API.md`). pickup — филиал самовывоза (обязателен); delivery — не
  учитывается, филиал выбирает сервер.
* **Idempotency-Key**: тот же ключ + то же тело → вернуть уже созданный
  заказ (`201`/`200`), не создавать второй. Тот же ключ + другое тело →
  `409 idempotency_key_reused`. Одновременные запросы с одним ключом: второй ждёт
  первый на уникальном индексе и получает тот же заказ. Область ключа — клиент.

Ответ `201` — объект заказа (ниже).

Порядок проверок на сервере: повтор по ключу → клиент (не заблокирован) → канал заказов
и публикация заведения → режим доставки (Mini App) → расчёт по БД (`item_unavailable`, `invalid_modifiers`,
`invalid_order`) → филиал: самовывоз — выбранный и его часы, доставка — адрес и выбор филиала с ценой → способ оплаты
(наличные при доставке и `courierMode: external` → `payment_method_unavailable`) → `cashChangeFrom` →
`delivery_fee_changed` → `price_changed` → `min_order_not_reached` → лимит активных заказов. Первая найденная проблема
возвращается сразу.

* **Канал и публикация.** Заказ (доставка и самовывоз) принимается, только если владелец
  включил канал заказов и опубликовал заведение (`API.md`, «Каналы и публикация»). Канал
  выключен → `422 ordering_channel_disabled`, включён без публикации или на паузе →
  `422 ordering_not_published`. `GET /tenant/config` в этом случае отдаёт
  `channels.delivery.published: false` и пустой `fulfillment.modes`.
* **Режим доставки.** Заголовок `X-Telegram-Init-Data` (`Telegram.WebApp.initData` внутри Mini App заведения).
  Режим `miniapp`: без заголовка → `403 miniapp_required`; `miniapp` и `both`: заголовок не подписан ботом заведения
  или просрочен → `403 miniapp_init_data_invalid`; режим `site` заголовок не смотрит. Бота нет при режиме
  `miniapp`/`both` → `503 telegram_unavailable`. Подробно: `API.md`, «Mini App и режимы доставки».
* **Филиал.** pickup — `branchId` обязателен, филиал должен быть открыт; филиал без расписания →
  `branch_hours_not_set`. delivery — из открытых филиалов с доставкой, чьи правила покрывают адрес, ближайший по
  прямой; та же функция, что у `GET /delivery/quote`, поэтому цена в корзине и в заказе совпадает, пока правила не
  изменились. Нет филиала с доставкой → `422 fulfillment_unavailable`; ни у одного нет правил →
  `422 delivery_not_configured` (самовывоз работает; `GET /tenant/config` тогда не включает `delivery` в
  `fulfillment.modes`); адрес без координат или вне правил всех филиалов → `422 out_of_delivery_zone`; покрывающие
  закрыты → `409 branch_closed` (ближайшее `opensAt` среди них) или `422 branch_hours_not_set`.
* **Цена доставки** фиксируется в заказе (`deliveryFee`) в момент оформления; минимальная сумма берётся из
  действующего правила филиала (зоны или расстояния), у самовывоза — `minOrderPickup` заведения.
* **Конкурентные повторы.** Два одинаковых запроса одновременно не создают два заказа:
  второй упирается в уникальный индекс `(customer_id, idempotency_key)` и получает
  тот же заказ.
* **Список** `GET /orders` не содержит `payment.url` (ссылка строится только в
  `GET /orders/:id` и ответах create/retry, пока заказ `awaiting_payment`).

## Объект заказа

```json
{
  "id": "uuid-or-short", "number": 1042,
  "status": "awaiting_payment",
  "fulfillmentMode": "delivery",
  "createdAt": "2026-10-09T10:00:00Z",
  "branchId": "main",
  "branch": { "id": "main", "title": "Mant 24/7", "address": "г. Ташкент, ..." },
  "address": { "...снимок как в /customers/me/addresses..." },
  "phone": "+998998168667", "comment": "",
  "paymentMethod": "click",
  "paymentStatus": "pending",
  "payment": { "url": "https://my.click.uz/...", "expiresAt": "...", "failReason": null },
  "items": [
    { "itemId": "manti-lamb", "name": "Мант с бараниной", "image": "/assets/..",
      "weight": "800 г", "currency": "UZS", "quantity": 2, "unitPrice": 48500,
      "modifiers": [ { "groupId": "toppings", "groupTitle": "Дополнительные добавки",
                       "options": [ { "id": "katyk-1", "name": "Катык", "price": 3500 } ] } ] }
  ],
  "currency": "UZS", "subtotal": 97000, "deliveryFee": 16000, "discount": 0, "total": 113000,
  "cashChangeFrom": null,
  "cancelledBy": null, "cancelReason": null
}
```

Позиции, адрес, `branch`, названия и цены — **снимок на момент заказа**: заказ не
должен меняться, если меню или адрес потом отредактируют.
`payment` — только для онлайн-методов; `payment.url` отдаётся, пока
`awaiting_payment`. `failReason`: `declined | expired | cancelled`.

### Статусы (`status`)

```
awaiting_payment ──оплата──▶ pending_acceptance ▶ accepted ▶ preparing ▶ on_the_way (delivery) / ready (pickup) ▶ completed
      │  └─отказ/истёк срок─▶ payment_failed ──retry──▶ awaiting_payment
cash ─────────────────────▶ pending_acceptance
любой из awaiting_payment / payment_failed / pending_acceptance / accepted ──▶ cancelled
```

`cancelled`: `cancelledBy` = `customer | restaurant | system`;
`cancelReason`, напр. `declined`, `no_response` (авто-отмена, если ресторан
не принял за 5 мин — по ранее спроектированной эскалации).
Клиент может отменить только из `awaiting_payment`, `payment_failed`,
`pending_acceptance`, `accepted`; иначе `409 cancel_not_allowed`.
Повторная отмена уже отменённого — не ошибка.

### `paymentStatus`
`not_required` (наличные) · `pending` · `paid` · `failed` · `cancelled` ·
`refund_pending` · `refunded`. Отмена оплаченного онлайн-заказа →
`refund_pending` (возврат через Click/Payme, `CancelTransaction`).

## Коды ошибок

| HTTP | code | details | Реакция клиента |
|---|---|---|---|
| 0 | `network_error` | — | «нет соединения», повтор с тем же ключом |
| 401 | `unauthorized` | — | открыть вход |
| 403 | `customer_blocked` | — | сообщение |
| 404 | `order_not_found` | — | «Заказ не найден» (в т.ч. чужой заказ) |
| 400 | `idempotency_key_required` | — | (ошибка клиента: нет/некорректный `Idempotency-Key`) |
| 400/422 | `validation_error`, `invalid_order` | для `invalid_order` сверх 50 одного блюда: `{ items: [{ itemId, quantity, max }] }` | сообщение |
| 422 | `fulfillment_unavailable` | — | сообщение (филиал не делает самовывоз/доставку) |
| 422 | `ordering_channel_disabled` | — | заведение не принимает заказы онлайн: оформление скрыто |
| 422 | `ordering_not_published` | — | заказы временно не принимаются (не опубликовано или пауза) |
| 403 | `miniapp_required` | — | заказ только в Telegram: ссылка `https://t.me/<channels.delivery.botUsername>` |
| 403 | `miniapp_init_data_invalid` | — | переоткрыть Mini App (данные Telegram устарели или чужие) |
| 503 | `telegram_unavailable` | — | режим Mini App без бота заведения: заказы недоступны |
| 429 | `too_many_active_orders` | `retryAfter` | сообщение |
| 422 | `invalid_modifiers` | `{ items: [{ index, itemId, reason, groupId? }] }` (`reason`: `missing_required`, `below_min`, `above_max`, `unknown_group`, `unknown_option`, `duplicate_group`, `duplicate_option`) | строки помечаются, «Убрать» |
| 409 | `item_unavailable` | `{ items: [{ index, reason }] }` | то же |
| 409 | `price_changed` | `{ items: [{ index, unitPrice }], subtotal, deliveryFee, total }` | цены в корзине обновляются, просим подтвердить |
| 409 | `delivery_fee_changed` | `{ deliveryFee, freeFrom, minOrder, total }` | новая цена доставки в корзине, просим подтвердить |
| 422 | `min_order_not_reached` | `{ minAmount, shortBy }` | сообщение «не хватает …» |
| 422 | `out_of_delivery_zone` | — | открывается список адресов |
| 422 | `delivery_not_configured` | — | доставка недоступна, предлагается самовывоз |
| 404 | `address_not_found` | — | то же |
| 409 | `branch_closed` | `{ opensAt }`: ISO 8601 с датой и поясом филиала (`"2026-11-11T09:00:00+05:00"`, как в `GET /branches`), `null` без открытий в 7 дней | сообщение «откроется сегодня/завтра в …» по дате |
| 422 | `branch_hours_not_set` | — | заведение ещё не задало часы работы: заказ недоступен |
| 422 | `payment_method_unavailable` | — | сбрасывается способ оплаты |
| 409 | `idempotency_key_reused` | — | клиент сам берёт новый ключ |
| 429 | `rate_limited` | `retryAfter` (сек) | сообщение |
| 409 | `cancel_not_allowed` | — | сообщение + обновление статуса |
| 409 | `payment_not_retryable` | — | сообщение |

`details.items[].index` — индекс в массиве `items` запроса.

`delivery_unavailable_no_zone` больше не отдаётся (заменён `delivery_not_configured`, `docs/ERRORS.md`).

## GET /checkout-config

```json
{ "currency": "UZS", "minOrderPickup": 0,
  "paymentMethods": { "delivery": ["cash", "click"], "pickup": ["cash", "click"] } }
```
`currency` из настроек заведения (`organization_settings`). `paymentMethods.delivery` без `cash`, если доставляют
только внешние службы (`courierMode: external`); самовывоз за наличные всегда. Цена и минимум доставки зависят от
адреса: `GET /delivery/quote`. Значения задаёт ресторан: `PUT /order-settings`, `PUT /branch/:id/delivery-pricing` и
`PUT /payment-provider/:provider`.

## Эндпоинты ресторана (панель, токен сотрудника)

| Метод | Путь | |
|---|---|---|
| GET | `/order?status=a,b&branchId=&cursor=&limit=` | список, новые первыми |
| GET | `/order/:id` | детали + клиент + журнал статусов |
| POST | `/order/:id/accept` | принять |
| POST | `/order/:id/reject` `{reason?}` | отклонить (оплаченный — возврат) |
| POST | `/order/:id/advance` | следующий этап по типу заказа |
| POST | `/order/:id/status` `{status}` | конкретный статус, если машина состояний разрешает |
| GET/PUT | `/order-settings` | минимум самовывоза, шаг округления цены доставки, способ доставки, таймауты |
| GET/PUT | `/branch/:id/delivery-pricing` | правила цены доставки филиала (`API.md`, «Стоимость доставки») |
| GET/PUT | `/payment-provider[/:provider]` | ключи Click/Payme (хранятся зашифрованно) |

Запрещённый переход → `409`. Тот же путь используют кнопки в Telegram-группе
филиала (`POST /telegram/orders/webhook`).

## Проверка сценариев без бэкенда

В консоли браузера (действует на следующий заказ):
`localStorage.setItem('xmenu:mock:scenario', 'price_changed')`.
Сценарии: `network_error`, `price_changed`, `item_unavailable`,
`branch_closed`, `out_of_zone`, `payment_failed`, `rejected`, `no_response`.

## Что бэкенду ещё понадобится (не реализовано на фронте)
* Данные меню для сервера: цены/опции/доступность — источник правды для расчёта.
* Уведомления ресторану (POS / Telegram / push) и авто-отмена через 5 мин — по уже спроектированной схеме.
