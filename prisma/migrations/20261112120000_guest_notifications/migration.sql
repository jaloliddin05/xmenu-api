-- Guest order notifications: the channel an order came from (site | Mini App) with the guest's Telegram id
-- and the venue bot, and the last undelivered notification on the customer.
-- CreateEnum
CREATE TYPE "public"."OrderChannel" AS ENUM ('site', 'miniapp');

-- AlterTable
ALTER TABLE "public"."customer" ADD COLUMN     "telegram_unreachable_at" TIMESTAMP(3),
ADD COLUMN     "telegram_unreachable_reason" TEXT;

-- AlterTable
ALTER TABLE "public"."customer_order" ADD COLUMN     "channel" "public"."OrderChannel" NOT NULL DEFAULT 'site',
ADD COLUMN     "guest_telegram_bot_id" TEXT,
ADD COLUMN     "guest_telegram_id" TEXT;

