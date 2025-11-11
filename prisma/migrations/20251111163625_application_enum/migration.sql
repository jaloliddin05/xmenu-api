/*
  Warnings:

  - Added the required column `tarif` to the `application` table without a default value. This is not possible if the table is not empty.
  - Made the column `fullName` on table `application` required. This step will fail if there are existing NULL values in that column.
  - Made the column `phone` on table `application` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `from` to the `application` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ApplicationFrom" AS ENUM ('admin', 'web');

-- AlterTable
ALTER TABLE "application" ADD COLUMN     "tarif" TEXT NOT NULL,
ALTER COLUMN "fullName" SET NOT NULL,
ALTER COLUMN "phone" SET NOT NULL,
DROP COLUMN "from",
ADD COLUMN     "from" "ApplicationFrom" NOT NULL;
