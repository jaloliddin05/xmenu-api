-- The webhook secret of a venue bot is kept as sha256 (hex); only Telegram keeps it in the clear.
-- Existing rows are hashed in place, so connected bots keep working without reconnecting.
ALTER TABLE "public"."organization_telegram_bot" RENAME COLUMN "webhook_secret" TO "webhook_secret_hash";

UPDATE "public"."organization_telegram_bot"
SET "webhook_secret_hash" = encode(sha256(convert_to("webhook_secret_hash", 'UTF8')), 'hex');
