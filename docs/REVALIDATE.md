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
`{ route, slug, secret, data }`; `id`, `slug`, `oldSlug`, `newSlug` принимаются и на верхнем уровне, и в `data`.
Для `route: 'menu'` сбрасывает `/{locale}/{slug}` по трём языкам (нужен `slug`). Для `route: 'organization'`
сбрасывает `/{locale}/organization/{id}`, `/{locale}/{oldSlug}` и `/{locale}/{newSlug}`; нужно хотя бы одно из
`id`, `oldSlug`, `newSlug`. Ответы: 503 при пустом секрете, 401 при неверном, 400 при плохом теле.

## Окружение
`NEXT_PUBLIC_URL` (адрес QR), `REVALIDATE_SECRET` (должен совпадать с QR; при пустом секрете QR отключает эндпоинт и
отвечает 503, задания будут повторяться и падать).
