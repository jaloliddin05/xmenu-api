#!/usr/bin/env bash
# Upgrade test for one migration on a NON-EMPTY database.
#
#   DATABASE_URL=postgresql://user:pass@host:5432/scratch_db scripts/check-migration-upgrade.sh
#
# 1. applies every migration before $TARGET_MIGRATION (default: channels_publication),
# 2. inserts a venue with settings, as it would exist before that migration,
# 3. applies the remaining migrations (`prisma migrate deploy`),
# 4. checks the existing row kept its data and got the column defaults.
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
  eta_min, eta_max, acceptance_timeout_seconds, payment_timeout_seconds, max_active_orders, updated_at)
values ('00000000-0000-4000-8000-000000000001', 10000, 50000, 0, 25, 40, 300, 900, 5, now());
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

orders="$("${PSQL[@]}" -F '|' -c "select delivery_service_fee, min_order_delivery, eta_min, eta_max from organization_order_settings where organization_id = '00000000-0000-4000-8000-000000000001'")"
if [ "$orders" != '10000|50000|25|40' ]; then
  echo "FAIL: order settings row changed: '$orders'" >&2
  exit 1
fi

echo "== schema matches the datamodel"
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel "$ROOT/prisma/schema.prisma" --exit-code

echo "OK: $TARGET_MIGRATION applies on a non-empty database with correct defaults"
