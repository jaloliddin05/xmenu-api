-- Delivery pricing per branch (docs/DELIVERY.md): zones and an optional distance rule on every branch instead of
-- one venue zone with one fee and minimum; the rounding step and who delivers (courier mode) on the venue;
-- the estimated delivery time is gone. Runs on a non-empty database: the venue zone, fee and delivery minimum
-- become a zone of every branch of that venue (scripts/check-migration-upgrade.sh).

-- CreateEnum
CREATE TYPE "public"."CourierMode" AS ENUM ('own', 'external', 'both');

-- CreateTable
CREATE TABLE "public"."branch_delivery_zone" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "polygon" JSONB NOT NULL,
    "price" INTEGER NOT NULL,
    "min_order" INTEGER NOT NULL,
    "free_from" INTEGER,

    CONSTRAINT "branch_delivery_zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."branch_delivery_distance" (
    "branch_id" TEXT NOT NULL,
    "base_price" INTEGER NOT NULL,
    "included_km" DOUBLE PRECISION NOT NULL,
    "price_per_km" INTEGER NOT NULL,
    "max_km" DOUBLE PRECISION NOT NULL,
    "min_order" INTEGER NOT NULL,
    "free_from" INTEGER,

    CONSTRAINT "branch_delivery_distance_pkey" PRIMARY KEY ("branch_id")
);

-- CreateIndex
CREATE INDEX "branch_delivery_zone_branch_id_position_idx" ON "public"."branch_delivery_zone"("branch_id", "position");

-- AddForeignKey
ALTER TABLE "public"."branch_delivery_zone" ADD CONSTRAINT "branch_delivery_zone_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."branch_delivery_distance" ADD CONSTRAINT "branch_delivery_distance_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: the venue zone (an array of at least 3 points, as the API accepted it) with the venue fee and delivery
-- minimum becomes the first zone of every branch of the venue. A venue without a zone did not deliver and still
-- does not: its branches get no rules.
INSERT INTO "public"."branch_delivery_zone" ("id", "branch_id", "position", "polygon", "price", "min_order", "free_from")
SELECT gen_random_uuid()::text, b."id", 0, s."delivery_zone", s."delivery_service_fee", s."min_order_delivery", NULL
FROM "public"."organization_order_settings" s
JOIN "public"."branch" b ON b."organization_id" = s."organization_id"
WHERE jsonb_typeof(s."delivery_zone") = 'array' AND jsonb_array_length(s."delivery_zone") >= 3;

-- AlterTable: new venue settings get values for existing rows, then lose the default (the platform defaults
-- live in organization/domain/platform-defaults.ts, not in the database)
ALTER TABLE "public"."organization_order_settings"
ADD COLUMN     "courier_mode" "public"."CourierMode" NOT NULL DEFAULT 'own',
ADD COLUMN     "delivery_price_step" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "public"."organization_order_settings"
ALTER COLUMN "courier_mode" DROP DEFAULT,
ALTER COLUMN "delivery_price_step" DROP DEFAULT;

ALTER TABLE "public"."organization_order_settings" DROP COLUMN "delivery_service_fee",
DROP COLUMN "delivery_zone",
DROP COLUMN "eta_max",
DROP COLUMN "eta_min",
DROP COLUMN "min_order_delivery";

-- AlterTable: service_fee always held the delivery fee
ALTER TABLE "public"."customer_order" RENAME COLUMN "service_fee" TO "delivery_fee";
ALTER TABLE "public"."customer_order" DROP COLUMN "eta_max",
DROP COLUMN "eta_min",
ADD COLUMN     "cash_change_from" INTEGER;
