-- CreateEnum
CREATE TYPE "public"."PosOrderState" AS ENUM ('queued', 'sending', 'sent', 'failed', 'needs_street', 'manual');

-- CreateEnum
CREATE TYPE "public"."PosDeliveredPush" AS ENUM ('none', 'pending', 'on_way', 'done', 'failed');

-- AlterEnum
ALTER TYPE "public"."OrderActor" ADD VALUE 'pos';

-- CreateTable
CREATE TABLE "public"."pos_order" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "state" "public"."PosOrderState" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "correlation_id" TEXT,
    "error" TEXT,
    "pos_number" TEXT,
    "pos_status" TEXT,
    "street_id" TEXT,
    "house" TEXT,
    "courier_name" TEXT,
    "delivered_push" "public"."PosDeliveredPush" NOT NULL DEFAULT 'none',
    "alerted" TEXT,
    "sent_at" TIMESTAMP(3),
    "manual_at" TIMESTAMP(3),
    "manual_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pos_order_order_id_key" ON "public"."pos_order"("order_id");

-- CreateIndex
CREATE INDEX "pos_order_integration_id_state_idx" ON "public"."pos_order"("integration_id", "state");

-- AddForeignKey
ALTER TABLE "public"."pos_order" ADD CONSTRAINT "pos_order_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."customer_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pos_order" ADD CONSTRAINT "pos_order_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."pos_integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

