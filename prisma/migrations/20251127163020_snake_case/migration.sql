/*
  Warnings:

  - The values [fast-food,coffee-shop] on the enum `OrganizationType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OrganizationType_new" AS ENUM ('restaurant', 'cafe', 'fast_food', 'coffee_shop', 'other');
ALTER TABLE "public"."organization" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "organization" ALTER COLUMN "type" TYPE "OrganizationType_new" USING ("type"::text::"OrganizationType_new");
ALTER TYPE "OrganizationType" RENAME TO "OrganizationType_old";
ALTER TYPE "OrganizationType_new" RENAME TO "OrganizationType";
DROP TYPE "public"."OrganizationType_old";
ALTER TABLE "organization" ALTER COLUMN "type" SET DEFAULT 'other';
COMMIT;
