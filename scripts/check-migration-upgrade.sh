#!/usr/bin/env bash
# Upgrade test for one migration on a NON-EMPTY database.
#
#   DATABASE_URL=postgresql://user:pass@host:5432/scratch_db scripts/check-migration-upgrade.sh
#
# 1. applies every migration before $TARGET_MIGRATION (default: channels_publication),
# 2. inserts a venue with settings, as it would exist before that migration,
# 3. applies the remaining migrations (`prisma migrate deploy`),
# 4. checks the existing row kept its data and got the column defaults,
#    and the venue bot's webhook secret was replaced by its sha256 hash,
#    the venue delivery zone, fee and minimum became a zone of each of its branches (delivery_pricing),
#    and the venue's owner became its owner row in organization_member,
# 5. checks the tenant_domain rules on that venue (one verified host per venue, pending claims by
#    several venues, cascade on delete),
# 6. before $POS_MIGRATION (default: pos_wave15) gives the venue an enabled iiko integration with a sent
#    and a queued order and a stop list, then checks they survive it: the order sent before is marked
#    confirmed, the stop rows keep the whole dish, one row per branch/dish/size is enforced.
#
# DATABASE_URL must point at an EMPTY scratch database: the script refuses to run otherwise.
# Needs psql and the project's dependencies (npx prisma). Exit code 1 on any mismatch.
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to an empty scratch database}"
TARGET_MIGRATION="${TARGET_MIGRATION:-20261031120000_channels_publication}"
POS_MIGRATION="${POS_MIGRATION:-20261120090000_pos_wave15}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL=(psql --dbname="$DATABASE_URL" -v ON_ERROR_STOP=1 -qtA)

tables="$("${PSQL[@]}" -c "select count(*) from information_schema.tables where table_schema = 'public'")"
if [ "$tables" != "0" ]; then
  echo "FAIL: database is not empty ($tables tables); use a fresh scratch database" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/prisma/migrations"
cp "$ROOT/prisma/schema.prisma" "$ROOT/prisma/migrations/migration_lock.toml" "$tmp/prisma/"
found=0
for dir in "$ROOT"/prisma/migrations/*/; do
  name="$(basename "$dir")"
  if [[ "$name" < "$TARGET_MIGRATION" ]]; then
    cp -r "$dir" "$tmp/prisma/migrations/$name"
  elif [ "$name" = "$TARGET_MIGRATION" ]; then
    found=1
  fi
done
if [ "$found" != "1" ]; then
  echo "FAIL: migration $TARGET_MIGRATION not found" >&2
  exit 1
fi

cd "$ROOT"
echo "== applying migrations before $TARGET_MIGRATION"
npx prisma migrate deploy --schema "$tmp/prisma/schema.prisma"

echo "== inserting a venue with data (state before $TARGET_MIGRATION)"
"${PSQL[@]}" <<'SQL'
insert into organization (id, name, slug, type, is_active, url)
values ('00000000-0000-4000-8000-000000000001', 'Mant', 'mant', 'restaurant', true, 'https://mant.example');
insert into organization_settings (organization_id, theme, currency, default_language, languages, support_phone, city, updated_at)
values ('00000000-0000-4000-8000-000000000001', '{"brand":"#EE2E17"}', 'UZS', 'ru', '{ru,uz}', '+998711234567', 'Tashkent', now());
insert into organization_order_settings (organization_id, delivery_service_fee, min_order_delivery, min_order_pickup,
  eta_min, eta_max, acceptance_timeout_seconds, payment_timeout_seconds, max_active_orders, delivery_zone, updated_at)
values ('00000000-0000-4000-8000-000000000001', 10000, 50000, 0, 25, 40, 300, 900, 5,
  '[[41.30, 69.20], [41.30, 69.30], [41.35, 69.25]]', now());
insert into branch (id, organization_id, title, address, latitude, longitude, updated_at)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'Center', 'Tashkent', 41.31, 69.25, now()),
       ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', 'North', 'Tashkent', 41.34, 69.26, now());
insert into organization_telegram_bot (id, organization_id, telegram_bot_id, username, token_encrypted, webhook_secret, updated_at)
values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000001', '123456789', 'mant_bot',
  'encrypted', 'plain-webhook-secret', now());
insert into "user" (id, phone, password, first_name, "isActive")
values ('00000000-0000-4000-8000-0000000000a1', '+998901112233', 'hash', 'Owner', true);
update organization set owner_id = '00000000-0000-4000-8000-0000000000a1' where id = '00000000-0000-4000-8000-000000000001';
SQL

echo "== applying the migrations before $POS_MIGRATION"
mkdir -p "$tmp/pos/prisma/migrations"
cp "$ROOT/prisma/schema.prisma" "$ROOT/prisma/migrations/migration_lock.toml" "$tmp/pos/prisma/"
for dir in "$ROOT"/prisma/migrations/*/; do
  name="$(basename "$dir")"
  if [[ "$name" < "$POS_MIGRATION" ]]; then
    cp -r "$dir" "$tmp/pos/prisma/migrations/$name"
  fi
done
if [ ! -d "$ROOT/prisma/migrations/$POS_MIGRATION" ]; then
  echo "FAIL: migration $POS_MIGRATION not found" >&2
  exit 1
fi
npx prisma migrate deploy --schema "$tmp/pos/prisma/schema.prisma"

echo "== inserting an iiko integration with orders and a stop list (state before $POS_MIGRATION)"
"${PSQL[@]}" <<'SQL'
insert into category (id, organization_id) values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001');
insert into product (id, price, unit, category_id)
values ('00000000-0000-4000-8000-0000000000e1', 30000, 'gr', '00000000-0000-4000-8000-0000000000c1');
insert into customer (id, phone, name, organization_id, updated_at)
values ('00000000-0000-4000-8000-0000000000f1', '+998901234567', 'Guest', '00000000-0000-4000-8000-000000000001', now());
insert into pos_integration (id, organization_id, status, api_key_encrypted, external_org_id, address_format, webhook_secret_hash, updated_at)
values ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'active', 'v1:encrypted', 'iiko-org',
  'legacy', 'hash', now());
insert into customer_order (id, number, organization_id, customer_id, branch_id, status, fulfillment, idempotency_key,
  request_hash, phone, payment_method, payment_status, currency, subtotal, total, updated_at)
values ('00000000-0000-4000-8000-000000000201', 1, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1',
  '00000000-0000-4000-8000-0000000000a1', 'accepted', 'delivery', 'k1', 'h1', '+998901234567', 'cash', 'not_required', 'UZS', 30000, 30000, now()),
       ('00000000-0000-4000-8000-000000000202', 2, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f1',
  '00000000-0000-4000-8000-0000000000a1', 'accepted', 'pickup', 'k2', 'h2', '+998901234567', 'cash', 'not_required', 'UZS', 30000, 30000, now());
insert into pos_order (id, order_id, integration_id, state, pos_number, sent_at, updated_at)
values ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101',
  'sent', '1042', '2026-11-18 10:00:00', now()),
       ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000101',
  'queued', null, null, now());
insert into pos_stop_item (id, integration_id, branch_id, product_id, balance)
values ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000e1', 0);
SQL

echo "== applying the remaining migrations"
npx prisma migrate deploy

echo "== checking the existing row"
row="$("${PSQL[@]}" -F '|' -c "select name, slug, is_active, url, qr_enabled, delivery_enabled, delivery_mode, coalesce(published_at::text, 'NULL') from organization where id = '00000000-0000-4000-8000-000000000001'")"
expected='Mant|mant|t|https://mant.example|t|f|site|NULL'
if [ "$row" != "$expected" ]; then
  echo "FAIL: organization row is '$row', expected '$expected'" >&2
  exit 1
fi
settings="$("${PSQL[@]}" -F '|' -c "select currency, default_language, city, theme->>'brand' from organization_settings where organization_id = '00000000-0000-4000-8000-000000000001'")"
if [ "$settings" != 'UZS|ru|Tashkent|#EE2E17' ]; then
  echo "FAIL: settings row changed: '$settings'" >&2
  exit 1
fi

# Payment at delivery (delivery_payment_methods): an existing venue takes cash only
orders="$("${PSQL[@]}" -F '|' -c "select min_order_pickup, acceptance_timeout_seconds, delivery_price_step, courier_mode, delivery_pay_cash, delivery_pay_card, delivery_pay_online from organization_order_settings where organization_id = '00000000-0000-4000-8000-000000000001'")"
if [ "$orders" != '0|300|100|own|t|f|f' ]; then
  echo "FAIL: order settings row is '$orders', expected '0|300|100|own|t|f|f'" >&2
  exit 1
fi

# The venue zone with its fee and minimum is now the first zone of every branch
zones="$("${PSQL[@]}" -c "select string_agg(branch_id || ':' || position || ':' || price || ':' || min_order || ':' || coalesce(free_from::text, 'NULL') || ':' || jsonb_array_length(polygon), ',' order by branch_id) from branch_delivery_zone")"
expected_zones='00000000-0000-4000-8000-0000000000a1:0:10000:50000:NULL:3,00000000-0000-4000-8000-0000000000a2:0:10000:50000:NULL:3'
if [ "$zones" != "$expected_zones" ]; then
  echo "FAIL: branch delivery zones are '$zones', expected '$expected_zones'" >&2
  exit 1
fi

# The webhook secret is hashed in place: the connected bot keeps working without reconnecting
bot="$("${PSQL[@]}" -c "select webhook_secret_hash = encode(sha256(convert_to('plain-webhook-secret', 'UTF8')), 'hex') from organization_telegram_bot where id = '00000000-0000-4000-8000-0000000000b1'")"
if [ "$bot" != 't' ]; then
  echo "FAIL: webhook secret of the existing bot is not its sha256 hash ('$bot')" >&2
  exit 1
fi

# organization.owner_id became the owner row in organization_member
member="$("${PSQL[@]}" -F '|' -c "select user_id, role, status, phone, first_name from organization_member where organization_id = '00000000-0000-4000-8000-000000000001'")"
if [ "$member" != '00000000-0000-4000-8000-0000000000a1|owner|active|+998901112233|Owner' ]; then
  echo "FAIL: the owner was not carried over to organization_member: '$member'" >&2
  exit 1
fi

echo "== tenant_domain on the existing venue"
ORG='00000000-0000-4000-8000-000000000001'
OTHER='00000000-0000-4000-8000-000000000002'
domains="$("${PSQL[@]}" -c "select count(*) from tenant_domain")"
if [ "$domains" != "0" ]; then
  echo "FAIL: tenant_domain has $domains rows after the upgrade, expected 0" >&2
  exit 1
fi
"${PSQL[@]}" <<SQL
insert into organization (id, name, slug, type, is_active) values ('$OTHER', 'Other', 'other-cafe', 'cafe', true);
insert into tenant_domain (id, organization_id, host, verification_token)
values ('00000000-0000-4000-8000-0000000000d1', '$ORG', 'restaurant.uz', 'token-a'),
       ('00000000-0000-4000-8000-0000000000d2', '$OTHER', 'restaurant.uz', 'token-b');
update tenant_domain set status = 'verified', verified_host = host, verified_at = now()
where id = '00000000-0000-4000-8000-0000000000d1';
SQL
pending="$("${PSQL[@]}" -c "select string_agg(status || '|' || coalesce(verified_host, 'NULL'), ',' order by id) from tenant_domain")"
if [ "$pending" != 'verified|restaurant.uz,pending|NULL' ]; then
  echo "FAIL: tenant_domain rows are '$pending'" >&2
  exit 1
fi
must_fail() {
  if "${PSQL[@]}" -c "$2" >/dev/null 2>&1; then
    echo "FAIL: $1 was accepted" >&2
    exit 1
  fi
}
must_fail "a second venue verifying the same host" \
  "update tenant_domain set status = 'verified', verified_host = host where id = '00000000-0000-4000-8000-0000000000d2'"
must_fail "the same host twice for one venue" \
  "insert into tenant_domain (id, organization_id, host, verification_token) values ('00000000-0000-4000-8000-0000000000d3', '$ORG', 'restaurant.uz', 'token-c')"
"${PSQL[@]}" -c "delete from organization where id = '$OTHER'"
left="$("${PSQL[@]}" -c "select count(*) from tenant_domain where organization_id = '$OTHER'")"
if [ "$left" != "0" ]; then
  echo "FAIL: deleting a venue left $left of its domains" >&2
  exit 1
fi
"${PSQL[@]}" -c "delete from tenant_domain"

echo "== the iiko integration, its orders and stop list after $POS_MIGRATION"
pos="$("${PSQL[@]}" -F '|' -c "select status, api_key_encrypted, address_format, coalesce(alert, 'NULL'), coalesce(disconnected_at::text, 'NULL') from pos_integration where id = '00000000-0000-4000-8000-000000000101'")"
if [ "$pos" != 'active|v1:encrypted|legacy|NULL|NULL' ]; then
  echo "FAIL: pos_integration row is '$pos'" >&2
  exit 1
fi
orders="$("${PSQL[@]}" -c "select string_agg(state || ':' || coalesce(pos_number, '-') || ':' || coalesce(confirmed_at::text, 'NULL'), ',' order by id) from pos_order")"
if [ "$orders" != 'sent:1042:2026-11-18 10:00:00,queued:-:NULL' ]; then
  echo "FAIL: pos_order rows are '$orders' (the order sent before must count as confirmed)" >&2
  exit 1
fi
stops="$("${PSQL[@]}" -c "select string_agg(product_id || ':' || coalesce(option_id, 'NULL'), ',') from pos_stop_item")"
if [ "$stops" != '00000000-0000-4000-8000-0000000000e1:NULL' ]; then
  echo "FAIL: pos_stop_item rows are '$stops'" >&2
  exit 1
fi
"${PSQL[@]}" <<'SQL'
insert into additional_product_group (id, organization_id, product_id) values ('00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000e1');
insert into additional_product (id, price, additional_product_group_id) values ('00000000-0000-4000-8000-000000000601', 0,
  '00000000-0000-4000-8000-000000000501');
insert into pos_stop_item (id, integration_id, branch_id, product_id, option_id)
values ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000601');
SQL
must_fail "the whole dish stopped twice in one branch" \
  "insert into pos_stop_item (id, integration_id, branch_id, product_id) values ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1')"
must_fail "one size stopped twice in one branch" \
  "insert into pos_stop_item (id, integration_id, branch_id, product_id, option_id) values ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000601')"
# Disconnecting keeps the integration without its key, and the orders with it
"${PSQL[@]}" -c "update pos_integration set status = 'disconnected', api_key_encrypted = null, disconnected_at = now() where id = '00000000-0000-4000-8000-000000000101'"
kept="$("${PSQL[@]}" -c "select count(*) from pos_order where integration_id = '00000000-0000-4000-8000-000000000101'")"
if [ "$kept" != "2" ]; then
  echo "FAIL: $kept orders left after disconnecting, expected 2" >&2
  exit 1
fi

echo "== schema matches the datamodel"
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel "$ROOT/prisma/schema.prisma" --exit-code

echo "OK: $TARGET_MIGRATION, $POS_MIGRATION and later migrations apply on a non-empty database with correct defaults"
