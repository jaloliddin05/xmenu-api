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
# 5. checks the tenant_domain rules on that venue (one verified host per venue, pending claims by
#    several venues, cascade on delete).
#
# DATABASE_URL must point at an EMPTY scratch database: the script refuses to run otherwise.
# Needs psql and the project's dependencies (npx prisma). Exit code 1 on any mismatch.
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to an empty scratch database}"
TARGET_MIGRATION="${TARGET_MIGRATION:-20261031120000_channels_publication}"
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

orders="$("${PSQL[@]}" -F '|' -c "select min_order_pickup, acceptance_timeout_seconds, delivery_price_step, courier_mode from organization_order_settings where organization_id = '00000000-0000-4000-8000-000000000001'")"
if [ "$orders" != '0|300|100|own' ]; then
  echo "FAIL: order settings row is '$orders', expected '0|300|100|own'" >&2
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

echo "== schema matches the datamodel"
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel "$ROOT/prisma/schema.prisma" --exit-code

echo "OK: $TARGET_MIGRATION and later migrations apply on a non-empty database with correct defaults"
