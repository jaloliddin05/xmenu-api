# Контракт API заказов (клиент → бэкенд)

Фронт уже вызывает эти эндпоинты через `src/features/orders/lib/ordersApi.js`.
Пока `NEXT_PUBLIC_ORDERS_MOCK` не `false`, вместо них работает эмулятор
`ordersMock.js` — он ведёт себя ровно так, как описано ниже, и служит
исполняемой версией этой спецификации.

Общее: заголовки `Authorization: Bearer`, `X-Tenant-Id` (как у остальных
customer-эндпоинтов). Ошибки — единый формат клиента:
`{ "error": { "code", "message", "retryAfter?", "details?" } }`.
Все эндпоинты — только для авторизованного клиента; чужой заказ = `404`.

## Эндпоинты

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/orders` | создать заказ (заголовок `Idempotency-Key` обязателен) |
| GET | `/orders/:id` | один заказ (его опрашивает экран отслеживания) |
| GET | `/orders` | история, новые первыми |
| GET | `/menu` | меню (публичный, `?lang=` или `Accept-Language`) |
| GET | `/checkout-config` | доставка/минимум/ETA/включённые способы оплаты (публичный) |
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
  "paymentMethod": "click",
  "items": [
    { "itemId": "manti-lamb", "quantity": 2,
      "modifiers": [ { "groupId": "toppings", "optionIds": ["katyk-1", "lazjon-1"] } ] }
  ],
  "expectedTotal": 112000
}
```

* Цен в запросе нет. Сервер считает всё сам: цена блюда + цены выбранных
  опций, сервисный сбор (только delivery), скидки.
* Одно блюдо может идти несколькими элементами `items` с разными
  `modifiers` — это разные позиции заказа.
* Сервер обязан проверить: блюдо/опции существуют и доступны; для каждой
  группы выполнены `required/min/max`; `quantity` 1..50; филиал открыт;
  адрес принадлежит клиенту и входит в зону; минимальная сумма;
  способ оплаты включён у тенанта.
* `expectedTotal` — сумма, которую видел клиент. Не совпала → `409 price_changed`.
* `branchId`: id из `GET /branches` (см. `BRANCHES_API.md`). pickup — филиал самовывоза; delivery — подсказка, сервер
  может выбрать другой филиал.
* **Idempotency-Key**: тот же ключ + то же тело → вернуть уже созданный
  заказ (`201`/`200`), не создавать второй. Тот же ключ + другое тело →
  `409 idempotency_key_reused`. Одновременные запросы с одним ключом: второй ждёт
  первый на уникальном индексе и получает тот же заказ. Область ключа — клиент.

Ответ `201` — объект заказа (ниже).

Порядок проверок на сервере: повтор по ключу → клиент (не заблокирован) → филиал и
его часы → адрес и зона доставки → способ оплаты → расчёт по БД (`item_unavailable`,
`invalid_modifiers`, `invalid_order`) → `price_changed` → `min_order_not_reached` →
лимит активных заказов. Первая найденная проблема возвращается сразу.

* **Филиал.** pickup — `branchId` обязателен, филиал должен быть открыт. delivery —
  `branchId` лишь подсказка: если он закрыт или не доставляет, берётся первый открытый
  филиал с доставкой; если открытых нет — `branch_closed` с ближайшим `opensAt`.
  Филиал без расписания считается открытым (`isOpen = null`).
* **Зона.** Если у тенанта задан `delivery_zone` (см. `PUT /order-settings`), адрес без
  координат или вне полигона → `out_of_delivery_zone`.
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
  "currency": "UZS", "subtotal": 97000, "serviceFee": 16000, "discount": 0, "total": 113000,
  "etaMinutes": [20, 30],
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
| 400/422 | `validation_error`, `invalid_order` | — | сообщение |
| 422 | `fulfillment_unavailable` | — | сообщение (филиал не делает самовывоз/доставку) |
| 429 | `too_many_active_orders` | `retryAfter` | сообщение |
| 422 | `invalid_modifiers` | `{ items: [{ index, itemId, reason, groupId? }] }` (`reason`: `missing_required`, `below_min`, `above_max`, `unknown_group`, `unknown_option`, `duplicate_group`, `duplicate_option`) | строки помечаются, «Убрать» |
| 409 | `item_unavailable` | `{ items: [{ index, reason }] }` | то же |
| 409 | `price_changed` | `{ items: [{ index, unitPrice }], subtotal, serviceFee, total }` | цены в корзине обновляются, просим подтвердить |
| 422 | `min_order_not_reached` | `{ minAmount }` | сообщение |
| 422 | `out_of_delivery_zone` | — | открывается список адресов |
| 404 | `address_not_found` | — | то же |
| 409 | `branch_closed` | `{ opensAt? }` | сообщение |
| 422 | `payment_method_unavailable` | — | сбрасывается способ оплаты |
| 409 | `idempotency_key_reused` | — | клиент сам берёт новый ключ |
| 429 | `rate_limited` | `retryAfter` (сек) | сообщение |
| 409 | `cancel_not_allowed` | — | сообщение + обновление статуса |
| 409 | `payment_not_retryable` | — | сообщение |

`details.items[].index` — индекс в массиве `items` запроса.

## GET /checkout-config

```json
{ "currency": "UZS", "deliveryServiceFee": 16000,
  "minOrder": { "delivery": 30000, "pickup": 0 },
  "etaMinutes": [20, 30], "paymentMethods": ["cash", "click"] }
```
Нужен корзине, чтобы оценка суммы совпадала с серверной (иначе `expectedTotal`
расходится и каждый заказ уходит в `price_changed`). Значения задаёт ресторан:
`PUT /order-settings` и `PUT /payment-provider/:provider`.

## Эндпоинты ресторана (панель, токен сотрудника)

| Метод | Путь | |
|---|---|---|
| GET | `/order?status=a,b&branchId=&cursor=&limit=` | список, новые первыми |
| GET | `/order/:id` | детали + клиент + журнал статусов |
| POST | `/order/:id/accept` `{etaMin?, etaMax?}` | принять |
| POST | `/order/:id/reject` `{reason?}` | отклонить (оплаченный — возврат) |
| POST | `/order/:id/advance` | следующий этап по типу заказа |
| POST | `/order/:id/status` `{status}` | конкретный статус, если машина состояний разрешает |
| GET/PUT | `/order-settings` | доставка, минимум, ETA, таймауты, зона |
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
* Опционально `POST /orders/quote` — предрасчёт сбора за доставку и зоны до оформления.
* Уведомления ресторану (POS / Telegram / push) и авто-отмена через 5 мин — по уже спроектированной схеме.
