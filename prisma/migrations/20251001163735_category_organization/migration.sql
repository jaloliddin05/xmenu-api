/*
  Warnings:

  - Added the required column `organization_id` to the `category` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."category_translation" DROP CONSTRAINT "category_translation_category_id_fkey";

-- AlterTable
ALTER TABLE "category" ADD COLUMN     "isActive" BOOLEAN DEFAULT true,
ADD COLUMN     "organization_id" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "category_translation" ADD CONSTRAINT "category_translation_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
