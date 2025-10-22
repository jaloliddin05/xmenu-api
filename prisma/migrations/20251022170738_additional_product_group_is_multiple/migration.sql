/*
  Warnings:

  - You are about to drop the column `type` on the `additional_product_group` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "additional_product_group" DROP COLUMN "type",
ADD COLUMN     "is_multiple" BOOLEAN DEFAULT false;

-- DropEnum
DROP TYPE "public"."additional_product_group_type";
