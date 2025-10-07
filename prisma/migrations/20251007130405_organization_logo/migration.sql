/*
  Warnings:

  - A unique constraint covering the columns `[logo_id]` on the table `organization` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[banner_id]` on the table `organization` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "banner_id" TEXT,
ADD COLUMN     "logo_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "organization_logo_id_key" ON "organization"("logo_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_banner_id_key" ON "organization"("banner_id");

-- AddForeignKey
ALTER TABLE "organization" ADD CONSTRAINT "organization_logo_id_fkey" FOREIGN KEY ("logo_id") REFERENCES "file"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization" ADD CONSTRAINT "organization_banner_id_fkey" FOREIGN KEY ("banner_id") REFERENCES "file"("id") ON DELETE SET NULL ON UPDATE CASCADE;
