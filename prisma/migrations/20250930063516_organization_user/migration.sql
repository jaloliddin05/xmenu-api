/*
  Warnings:

  - The `type` column on the `organization` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[owner_id]` on the table `organization` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "public"."OrganizationType" AS ENUM ('restaurant', 'cafe', 'fast-food', 'coffee-shop', 'other');

-- AlterTable
ALTER TABLE "public"."organization" ADD COLUMN     "owner_id" TEXT,
DROP COLUMN "type",
ADD COLUMN     "type" "public"."OrganizationType" NOT NULL DEFAULT 'other';

-- DropEnum
DROP TYPE "public"."Role";

-- CreateIndex
CREATE UNIQUE INDEX "organization_owner_id_key" ON "public"."organization"("owner_id");

-- AddForeignKey
ALTER TABLE "public"."organization" ADD CONSTRAINT "organization_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
