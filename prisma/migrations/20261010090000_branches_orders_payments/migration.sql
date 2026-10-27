-- CreateEnum
CREATE TYPE "public"."OrderStatus" AS ENUM ('awaiting_payment', 'payment_failed', 'pending_acceptance', 'accepted', 'preparing', 'on_the_way', 'ready', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."OrderFulfillment" AS ENUM ('delivery', 'pickup');

-- CreateEnum
CREATE TYPE "public"."OrderPaymentMethod" AS ENUM ('cash', 'click', 'payme');

-- CreateEnum
CREATE TYPE "public"."OrderPaymentStatus" AS ENUM ('not_required', 'pending', 'paid', 'failed', 'cancelled', 'refund_pending', 'refunded');

-- CreateEnum
CREATE TYPE "public"."OrderActor" AS ENUM ('customer', 'restaurant', 'system', 'payment');

-- CreateEnum
CREATE TYPE "public"."OrderPaymentProvider" AS ENUM ('click', 'payme');

-- CreateEnum
CREATE TYPE "public"."PaymentTransactionStatus" AS ENUM ('created', 'paid', 'cancelled', 'refunded', 'failed');

-- AlterTable
ALTER TABLE "public"."additional_product_group" ADD COLUMN     "max_selected" INTEGER,
ADD COLUMN     "min_selected" INTEGER;

-- AlterTable
ALTER TABLE "public"."organization" ADD COLUMN     "order_seq" INTEGER NOT NULL DEFAULT 1000;

-- CreateTable
CREATE TABLE "public"."branch" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    "accepts_pickup" BOOLEAN NOT NULL DEFAULT true,
    "accepts_delivery" BOOLEAN NOT NULL DEFAULT true,
    "telegram_chat_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."branch_working_hours" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "opens_at" TEXT NOT NULL DEFAULT '00:00',
    "closes_at" TEXT NOT NULL DEFAULT '00:00',
    "is_24h" BOOLEAN NOT NULL DEFAULT false,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "branch_working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."branch_hours_exception" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "opens_at" TEXT,
    "closes_at" TEXT,
    "is_24h" BOOLEAN NOT NULL DEFAULT false,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "branch_hours_exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customer_order" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "organization_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "status" "public"."OrderStatus" NOT NULL,
    "fulfillment" "public"."OrderFulfillment" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "comment" TEXT,
    "address_snapshot" JSONB,
    "payment_method" "public"."OrderPaymentMethod" NOT NULL,
    "payment_status" "public"."OrderPaymentStatus" NOT NULL,
    "payment_expires_at" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'UZS',
    "subtotal" INTEGER NOT NULL,
    "service_fee" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "eta_min" INTEGER NOT NULL,
    "eta_max" INTEGER NOT NULL,
    "cancelled_by" "public"."OrderActor",
    "cancel_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "placed_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "tg_chat_id" TEXT,
    "tg_message_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customer_order_item" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "weight" TEXT,
    "base_price" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "customer_order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customer_order_item_option" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "group_id" TEXT,
    "group_title" TEXT NOT NULL,
    "option_id" TEXT,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "customer_order_item_option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."order_status_event" (
    "id" BIGSERIAL NOT NULL,
    "order_id" TEXT NOT NULL,
    "from_status" "public"."OrderStatus",
    "to_status" "public"."OrderStatus" NOT NULL,
    "actor" "public"."OrderActor" NOT NULL,
    "actor_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organization_order_settings" (
    "organization_id" TEXT NOT NULL,
    "delivery_service_fee" INTEGER NOT NULL DEFAULT 0,
    "min_order_delivery" INTEGER NOT NULL DEFAULT 0,
    "min_order_pickup" INTEGER NOT NULL DEFAULT 0,
    "eta_min" INTEGER NOT NULL DEFAULT 20,
    "eta_max" INTEGER NOT NULL DEFAULT 30,
    "acceptance_timeout_seconds" INTEGER NOT NULL DEFAULT 300,
    "payment_timeout_seconds" INTEGER NOT NULL DEFAULT 900,
    "max_active_orders" INTEGER NOT NULL DEFAULT 5,
    "delivery_zone" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_order_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "public"."order_payment" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "order_id" TEXT NOT NULL,
    "provider" "public"."OrderPaymentProvider" NOT NULL,
    "status" "public"."PaymentTransactionStatus" NOT NULL DEFAULT 'created',
    "amount" INTEGER NOT NULL,
    "provider_transaction_id" TEXT,
    "provider_payment_id" TEXT,
    "provider_state" INTEGER,
    "provider_create_time" BIGINT,
    "cancel_reason" INTEGER,
    "expires_at" TIMESTAMP(3),
    "performed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organization_payment_provider" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "provider" "public"."OrderPaymentProvider" NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "config_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_payment_provider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branch_organization_id_is_active_sort_order_idx" ON "public"."branch"("organization_id", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "branch_working_hours_branch_id_weekday_key" ON "public"."branch_working_hours"("branch_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "branch_hours_exception_branch_id_date_key" ON "public"."branch_hours_exception"("branch_id", "date");

-- CreateIndex
CREATE INDEX "customer_order_organization_id_status_created_at_idx" ON "public"."customer_order"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "customer_order_customer_id_created_at_idx" ON "public"."customer_order"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "customer_order_branch_id_status_idx" ON "public"."customer_order"("branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_order_organization_id_number_key" ON "public"."customer_order"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "customer_order_customer_id_idempotency_key_key" ON "public"."customer_order"("customer_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "customer_order_item_order_id_idx" ON "public"."customer_order_item"("order_id");

-- CreateIndex
CREATE INDEX "customer_order_item_option_item_id_idx" ON "public"."customer_order_item_option"("item_id");

-- CreateIndex
CREATE INDEX "order_status_event_order_id_created_at_idx" ON "public"."order_status_event"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_payment_seq_key" ON "public"."order_payment"("seq");

-- CreateIndex
CREATE INDEX "order_payment_order_id_idx" ON "public"."order_payment"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_payment_provider_provider_transaction_id_key" ON "public"."order_payment"("provider", "provider_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_payment_provider_organization_id_provider_key" ON "public"."organization_payment_provider"("organization_id", "provider");

-- AddForeignKey
ALTER TABLE "public"."branch" ADD CONSTRAINT "branch_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."branch_working_hours" ADD CONSTRAINT "branch_working_hours_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."branch_hours_exception" ADD CONSTRAINT "branch_hours_exception_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_order" ADD CONSTRAINT "customer_order_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_order" ADD CONSTRAINT "customer_order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_order" ADD CONSTRAINT "customer_order_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_order_item" ADD CONSTRAINT "customer_order_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."customer_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_order_item" ADD CONSTRAINT "customer_order_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_order_item_option" ADD CONSTRAINT "customer_order_item_option_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."customer_order_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."order_status_event" ADD CONSTRAINT "order_status_event_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."customer_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."organization_order_settings" ADD CONSTRAINT "organization_order_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."order_payment" ADD CONSTRAINT "order_payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."customer_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."organization_payment_provider" ADD CONSTRAINT "organization_payment_provider_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma ifodalay olmaydigan qoidalar (qo'lda; customer_address_integrity bilan bir xil yondashuv):
-- pul summalari manfiy bo'lmasligi, total = subtotal + service_fee - discount,
-- ish vaqti HH:mm formati, hafta kuni 1..7.
ALTER TABLE "public"."customer_order" ADD CONSTRAINT "customer_order_amounts_check"
  CHECK ("subtotal" >= 0 AND "service_fee" >= 0 AND "discount" >= 0 AND "total" = "subtotal" + "service_fee" - "discount" AND "total" >= 0);

ALTER TABLE "public"."customer_order_item" ADD CONSTRAINT "customer_order_item_quantity_check"
  CHECK ("quantity" >= 1 AND "unit_price" >= 0 AND "base_price" >= 0);

ALTER TABLE "public"."branch_working_hours" ADD CONSTRAINT "branch_working_hours_weekday_check"
  CHECK ("weekday" BETWEEN 1 AND 7 AND "opens_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "closes_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE "public"."order_payment" ADD CONSTRAINT "order_payment_amount_check" CHECK ("amount" > 0);
