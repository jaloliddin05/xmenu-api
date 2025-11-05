/*
  Warnings:

  - A unique constraint covering the columns `[slug]` on the table `organization` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");
