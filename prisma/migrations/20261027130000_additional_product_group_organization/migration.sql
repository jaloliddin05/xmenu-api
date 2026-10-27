-- AlterTable
ALTER TABLE "public"."additional_product_group" ADD COLUMN     "organization_id" TEXT;

-- Backfill: groups attached to a dish belong to the dish's organization. Groups without a dish
-- (created and never attached) have no recoverable owner and stay NULL, i.e. reachable by no one.
UPDATE "public"."additional_product_group" AS g
SET "organization_id" = c."organization_id"
FROM "public"."product" AS p
JOIN "public"."category" AS c ON c."id" = p."category_id"
WHERE g."product_id" = p."id";

-- CreateIndex
CREATE INDEX "additional_product_group_organization_id_idx" ON "public"."additional_product_group"("organization_id");

-- AddForeignKey
ALTER TABLE "public"."additional_product_group" ADD CONSTRAINT "additional_product_group_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
