-- Channels and publication of a venue. NOT NULL columns carry defaults, so existing rows get
-- QR on, ordering off, website mode and no publication (safe on a non-empty table).

-- CreateEnum
CREATE TYPE "public"."DeliveryMode" AS ENUM ('site', 'miniapp', 'both');

-- AlterTable
ALTER TABLE "public"."organization" ADD COLUMN     "delivery_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "delivery_mode" "public"."DeliveryMode" NOT NULL DEFAULT 'site',
ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "qr_enabled" BOOLEAN NOT NULL DEFAULT true;
