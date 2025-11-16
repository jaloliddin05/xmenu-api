/*
  Warnings:

  - You are about to drop the column `isActive` on the `category` table. All the data in the column will be lost.
  - You are about to drop the column `isActive` on the `organization` table. All the data in the column will be lost.
  - You are about to drop the column `isActive` on the `product` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "category" DROP COLUMN "isActive",
ADD COLUMN     "is_active" BOOLEAN DEFAULT true;

-- AlterTable
ALTER TABLE "organization" DROP COLUMN "isActive",
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "product" DROP COLUMN "isActive",
ADD COLUMN     "is_active" BOOLEAN DEFAULT true;
