/*
  Warnings:

  - A unique constraint covering the columns `[int_id]` on the table `organization` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "int_id" SERIAL;

-- CreateIndex
CREATE UNIQUE INDEX "organization_int_id_key" ON "organization"("int_id");
