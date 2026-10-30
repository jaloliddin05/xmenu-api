-- AlterTable
ALTER TABLE "public"."organization_telegram_bot" ADD COLUMN     "profile" JSONB,
ADD COLUMN     "sync_result" JSONB,
ADD COLUMN     "synced_at" TIMESTAMP(3);
