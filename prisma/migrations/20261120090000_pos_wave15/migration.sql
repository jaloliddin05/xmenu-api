-- POS integration fixes of wave 15 (audit/WAVE15.md). Nothing is dropped: a disconnected integration
-- stays with its orders; existing rows keep their data.

-- AlterEnum
ALTER TYPE "public"."PosAddressFormat" ADD VALUE 'international';
ALTER TYPE "public"."PosAddressFormat" ADD VALUE 'int_no_postcode';

-- AlterEnum
ALTER TYPE "public"."PosIntegrationStatus" ADD VALUE 'disconnected';

-- DropIndex
DROP INDEX "public"."pos_stop_item_branch_id_product_id_key";

-- AlterTable
ALTER TABLE "public"."pos_integration" ADD COLUMN     "alert" TEXT,
ADD COLUMN     "alert_at" TIMESTAMP(3),
ADD COLUMN     "disconnected_at" TIMESTAMP(3),
ALTER COLUMN "api_key_encrypted" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."pos_order" ADD COLUMN     "confirmed_at" TIMESTAMP(3);

-- Orders already in iiko were confirmed right after they were created
UPDATE "public"."pos_order" SET "confirmed_at" = "sent_at" WHERE "state" = 'sent' AND "sent_at" IS NOT NULL;

-- AlterTable
ALTER TABLE "public"."pos_stop_item" ADD COLUMN     "option_id" TEXT;

-- CreateIndex
CREATE INDEX "pos_stop_item_branch_id_product_id_idx" ON "public"."pos_stop_item"("branch_id", "product_id");

-- AddForeignKey
ALTER TABLE "public"."pos_stop_item" ADD CONSTRAINT "pos_stop_item_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "public"."additional_product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One stop row per branch and dish (whole dish) or per branch, dish and size. Partial unique indexes
-- are written by hand: Prisma's schema cannot express them (the model keeps a plain index)
CREATE UNIQUE INDEX "pos_stop_item_branch_product_whole_key" ON "public"."pos_stop_item"("branch_id", "product_id") WHERE "option_id" IS NULL;
CREATE UNIQUE INDEX "pos_stop_item_branch_product_option_key" ON "public"."pos_stop_item"("branch_id", "product_id", "option_id") WHERE "option_id" IS NOT NULL;
