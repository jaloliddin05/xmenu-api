-- CreateEnum
CREATE TYPE "public"."CashCollection" AS ENUM ('cash', 'card');

-- AlterTable
ALTER TABLE "public"."courier" ADD COLUMN     "pay_included_km" DOUBLE PRECISION,
ADD COLUMN     "pay_per_delivery" INTEGER,
ADD COLUMN     "pay_per_km" INTEGER;

-- AlterTable
ALTER TABLE "public"."courier_shift" ADD COLUMN     "cash_discrepancy" INTEGER,
ADD COLUMN     "cash_due" INTEGER,
ADD COLUMN     "cash_received" INTEGER,
ADD COLUMN     "reconciled_at" TIMESTAMP(3),
ADD COLUMN     "reconciled_by_user_id" TEXT;

-- AlterTable
ALTER TABLE "public"."customer_order" ADD COLUMN     "cash_collected" "public"."CashCollection",
ADD COLUMN     "courier_distance_km" DOUBLE PRECISION,
ADD COLUMN     "courier_pay" INTEGER,
ADD COLUMN     "door_problem_at" TIMESTAMP(3),
ADD COLUMN     "external_cash_received" BOOLEAN,
ADD COLUMN     "external_cost" INTEGER,
ADD COLUMN     "external_handed_at" TIMESTAMP(3),
ADD COLUMN     "external_service" TEXT,
ADD COLUMN     "picked_up_at" TIMESTAMP(3),
ADD COLUMN     "ready_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."organization_order_settings" ADD COLUMN     "courier_pay_included_km" DOUBLE PRECISION,
ADD COLUMN     "courier_pay_per_delivery" INTEGER,
ADD COLUMN     "courier_pay_per_km" INTEGER,
ADD COLUMN     "door_wait_minutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "on_the_way_alert_minutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "pickup_reminder_minutes" INTEGER NOT NULL DEFAULT 5;

-- Existing rows got the platform defaults; new rows get them from platform-defaults.ts (no DEFAULT in the DB)
ALTER TABLE "public"."organization_order_settings" ALTER COLUMN "door_wait_minutes" DROP DEFAULT,
ALTER COLUMN "on_the_way_alert_minutes" DROP DEFAULT,
ALTER COLUMN "pickup_reminder_minutes" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "customer_order_courier_shift_id_status_idx" ON "public"."customer_order"("courier_shift_id", "status");

-- CreateIndex
CREATE INDEX "customer_order_organization_id_external_handed_at_idx" ON "public"."customer_order"("organization_id", "external_handed_at");

