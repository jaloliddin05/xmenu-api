# Ревалидация QR-меню

Бэкенд ставит задание в очередь `revalidate-queue` (BullMQ) при изменении меню или организации. Через 20 с
процессор шлёт `POST {NEXT_PUBLIC_URL}/api/revalidate` в приложение `xmenu-qr`. Код: `src/modules/revalidate-queue/`.

## Задание (payload)
| Случай | Payload | Кто ставит |
|---|---|---|
| Меню изменилось | `{ slug }` | category, product, additional-product, organization (без смены slug) |
| Сменился slug | `{ id, newSlug, oldSlug, route: 'organization' }` | `OrganizationService.update` |

## Идентификатор задания
`revalidate-{route}-{slug}` для меню и `revalidate-organization-{id}` для организации (части URI-кодируются, без `:`).
Slug организации уникален в БД, поэтому ключ однозначно задаёт тенанта. Повторная правка того же тенанта за 20 с
заменяет ожидающее задание; правки разных тенантов друг друга не затирают. Раньше ключ строился из объекта
(`revalidate-[object Object]`) и был общим для всех тенантов (P-04).

## Тело запроса к QR (формат не менять)
```json
{ "route": "menu", "slug": "mant", "secret": "<REVALIDATE_SECRET>" }
{ "route": "organization", "id": "<org id>", "newSlug": "…", "oldSlug": "…", "secret": "<REVALIDATE_SECRET>" }
```
`route` по умолчанию `menu`; поля payload добавляются на верхний уровень, затем `secret`.

## Что читает QR (`xmenu-qr/src/app/api/revalidate/route.js`)
`{ route, slug, secret, data }`. Для `route: 'menu'` сбрасывает `/{locale}/{slug}` по трём языкам. Для
`route: 'organization'` читает `data.id`, `data.oldSlug`, `data.newSlug`.

## Известное расхождение (Q-01, чинится в QR)
Бэкенд кладёт `id`, `oldSlug`, `newSlug` на верхний уровень, а QR ждёт их в `data`. При смене slug `data` пуст, QR
падает с 500, задание повторяется (5 попыток, экспоненциальная пауза). Формат тела здесь не меняется: правка должна
быть в QR (принимать оба варианта).

## Окружение
`NEXT_PUBLIC_URL` (адрес QR), `REVALIDATE_SECRET` (должен совпадать с QR; пустой секрет в QR пропускает любые запросы, Q-05).
