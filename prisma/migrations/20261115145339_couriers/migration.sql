-- Own couriers of a venue: couriers, one-time bot invitations, shifts, order cards in the courier chat;
-- delivery statuses problem_at_door, returned_to_restaurant, handed_to_external and the courier actor.
-- CreateEnum
CREATE TYPE "public"."CourierShiftStatus" AS ENUM ('open', 'awaiting_reconciliation', 'reconciled');

-- CreateEnum
CREATE TYPE "public"."DoorProblem" AS ENUM ('no_answer', 'refused');

-- AlterEnum
ALTER TYPE "public"."OrderActor" ADD VALUE 'courier';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."OrderStatus" ADD VALUE 'problem_at_door';
ALTER TYPE "public"."OrderStatus" ADD VALUE 'returned_to_restaurant';
ALTER TYPE "public"."OrderStatus" ADD VALUE 'handed_to_external';

-- AlterTable
ALTER TABLE "public"."customer_order" ADD COLUMN     "courier_assigned_at" TIMESTAMP(3),
ADD COLUMN     "courier_id" TEXT,
ADD COLUMN     "courier_shift_id" TEXT,
ADD COLUMN     "door_problem" "public"."DoorProblem",
ADD COLUMN     "door_problem_reason" TEXT;

-- CreateTable
CREATE TABLE "public"."courier" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "telegram_user_id" TEXT,
    "telegram_chat_id" TEXT,
    "language_code" TEXT,
    "linked_at" TIMESTAMP(3),
    "disabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."courier_invitation" (
    "id" TEXT NOT NULL,
    "courier_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."courier_shift" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "courier_id" TEXT NOT NULL,
    "status" "public"."CourierShiftStatus" NOT NULL DEFAULT 'open',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "ended_by" TEXT,
    "ended_by_user_id" TEXT,

    CONSTRAINT "courier_shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."courier_card" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "courier_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "message_id" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courier_card_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "courier_organization_id_is_active_idx" ON "public"."courier"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "courier_organization_id_phone_key" ON "public"."courier"("organization_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "courier_organization_id_telegram_user_id_key" ON "public"."courier"("organization_id", "telegram_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "courier_invitation_token_hash_key" ON "public"."courier_invitation"("token_hash");

-- CreateIndex
CREATE INDEX "courier_invitation_courier_id_idx" ON "public"."courier_invitation"("courier_id");

-- CreateIndex
CREATE INDEX "courier_shift_organization_id_status_idx" ON "public"."courier_shift"("organization_id", "status");

-- CreateIndex
CREATE INDEX "courier_shift_courier_id_status_idx" ON "public"."courier_shift"("courier_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "courier_card_order_id_courier_id_key" ON "public"."courier_card"("order_id", "courier_id");

-- CreateIndex
CREATE INDEX "customer_order_courier_id_status_idx" ON "public"."customer_order"("courier_id", "status");

-- AddForeignKey
ALTER TABLE "public"."courier" ADD CONSTRAINT "courier_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."courier_invitation" ADD CONSTRAINT "courier_invitation_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "public"."courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."courier_shift" ADD CONSTRAINT "courier_shift_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."courier_shift" ADD CONSTRAINT "courier_shift_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "public"."courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."courier_card" ADD CONSTRAINT "courier_card_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."customer_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."courier_card" ADD CONSTRAINT "courier_card_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "public"."courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_order" ADD CONSTRAINT "customer_order_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "public"."courier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_order" ADD CONSTRAINT "customer_order_courier_shift_id_fkey" FOREIGN KEY ("courier_shift_id") REFERENCES "public"."courier_shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one open shift per courier
CREATE UNIQUE INDEX "courier_shift_one_open_per_courier" ON "public"."courier_shift"("courier_id") WHERE "status" = 'open';
