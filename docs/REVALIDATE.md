# Ревалидация фронтов (QR-меню и сайт доставки)

Бэкенд ставит задания в очередь `revalidate-queue` (BullMQ), когда меняется то, что фронты отдают из кэша (ISR).
Через 20 с процессор шлёт `POST` в приложение. Код: `src/modules/revalidate-queue/`.
Одно изменение даёт по заданию на каждую цель:

| Цель | Адрес | Секрет | Когда ставится |
|---|---|---|---|
| `qr` (`xmenu-qr`) | `{NEXT_PUBLIC_URL}/api/revalidate` | `REVALIDATE_SECRET` | все `route`, кроме `branches` |
| `client` (`xmenu-client`) | `CLIENT_REVALIDATE_URL` (полный адрес) | `CLIENT_REVALIDATE_SECRET` | все `route`, если `CLIENT_REVALIDATE_URL` задан |

## Изменение (`TenantChange`)
| `route` | Что изменилось | Кто ставит |
|---|---|---|
| `menu` | категории, блюда, группы допов, допы | category, product, additional-product |
| `organization` | имя, тип, slug, логотип, баннер, описание (`PUT /organization/:id`) | `OrganizationService.update` |
| `settings` | настройки заведения (`PUT /organization/:id/settings`), настройки заказа и зона (`PUT /order-settings`) | `OrganizationSettingsService.replace`, `OrderSettingsController` |
| `branches` | филиалы, часы работы, исключения | `BranchService` |

Поля: `tenantId` (id организации), `route`, `oldSlug` (только при смене slug, иначе `null`). Вызывающий может передать
`slug`, но в очередь он не попадает: процессор читает текущий slug по `tenantId` в момент выполнения задания (в том числе
при повторе после ошибки), поэтому переименование между постановкой и выполнением не отправит старый slug. Нет
организации (удалена) → задание пропускается; нет slug → пропускается задание QR.

## Идентификатор задания
`revalidate-{target}-{route}-{tenantId}` (части URI-кодируются, без `:`). Повторная правка того же тенанта и того же
`route` за 20 с заменяет ожидающее задание; разные тенанты, цели и `route` друг друга не затирают. Slug в ключ не
входит: он меняется, id нет.

## Тело запроса к QR (формат не менять, его читает `xmenu-qr`)
```json
{ "route": "menu", "slug": "mant", "secret": "<REVALIDATE_SECRET>" }
{ "route": "organization", "id": "<org id>", "newSlug": "…", "oldSlug": "…", "secret": "<REVALIDATE_SECRET>" }
```
Смена slug (`organization` с `oldSlug`, отличным от `slug`) уходит вторым видом, всё остальное (`menu`, `settings`,
`organization` без смены slug) первым. Без slug задание QR пропускается.

### Что читает QR (`xmenu-qr/src/app/api/revalidate/route.js`)
`{ route, slug, secret, data }`; `id`, `slug`, `oldSlug`, `newSlug` принимаются и на верхнем уровне, и в `data`.
Для `route: 'menu'` сбрасывает `/{locale}/{slug}` по трём языкам (нужен `slug`). Для `route: 'organization'`
сбрасывает `/{locale}/organization/{id}`, `/{locale}/{oldSlug}` и `/{locale}/{newSlug}`; нужно хотя бы одно из
`id`, `oldSlug`, `newSlug`. Ответы: 503 при пустом секрете, 401 при неверном, 400 при плохом теле.

## Тело запроса к сайту доставки (приёмник пишет `xmenu-client`, задача C2)
```json
{
  "secret": "<CLIENT_REVALIDATE_SECRET>",
  "tenantId": "<org id>",
  "route": "menu | organization | settings | branches",
  "slug": "mant",
  "oldSlug": null
}
```
- `tenantId` всегда есть; по нему клиент сбрасывает тег `tenant:{tenantId}` (рекомендуется: все данные тенанта в
  ISR помечены этим тегом).
- `slug` текущий (может быть `null`, если slug не задан); `oldSlug` не `null` только при смене slug: старый поддомен
  `{oldSlug}.xmenu.uz` надо сбросить (истории slug нет, старый адрес после ревалидации отдаёт 404).
- `route` подсказывает, что изменилось; клиент может сбрасывать всё по тегу и не различать `route`.
- Ожидаемые ответы: 200 при успехе; 401 при неверном секрете; 503, если секрет на стороне клиента пуст; 400 при плохом
  теле. Любой ответ, кроме 200, бэкенд считает ошибкой и повторяет (5 попыток, экспоненциально от 60 с).

## Окружение
- `NEXT_PUBLIC_URL` (адрес QR), `REVALIDATE_SECRET` (совпадает с QR; при пустом секрете QR отвечает 503, задания
  повторяются и падают).
- `CLIENT_REVALIDATE_URL` (полный адрес приёмника, например `http://127.0.0.1:3002/api/revalidate` на том же
  сервере), `CLIENT_REVALIDATE_SECRET` (совпадает с клиентом). Пустой `CLIENT_REVALIDATE_URL`: заданий для клиента нет.
