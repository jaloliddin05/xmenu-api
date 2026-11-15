-- Staff of a venue (owner and operators) replaces organization.owner_id.
-- CreateEnum
CREATE TYPE "public"."StaffRole" AS ENUM ('owner', 'operator');

-- CreateEnum
CREATE TYPE "public"."StaffStatus" AS ENUM ('invited', 'active', 'disabled');

-- CreateTable
CREATE TABLE "public"."organization_member" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT,
    "role" "public"."StaffRole" NOT NULL,
    "status" "public"."StaffStatus" NOT NULL,
    "phone" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "invited_by_id" TEXT,
    "invite_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMP(3),
    "disabled_at" TIMESTAMP(3),

    CONSTRAINT "organization_member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_member_user_id_key" ON "public"."organization_member"("user_id");

-- CreateIndex
CREATE INDEX "organization_member_phone_idx" ON "public"."organization_member"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "organization_member_organization_id_phone_key" ON "public"."organization_member"("organization_id", "phone");

-- AddForeignKey
ALTER TABLE "public"."organization_member" ADD CONSTRAINT "organization_member_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."organization_member" ADD CONSTRAINT "organization_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing owners become the owner rows of their venues
INSERT INTO "public"."organization_member" ("id", "organization_id", "user_id", "role", "status", "phone", "first_name", "last_name", "activated_at")
SELECT gen_random_uuid()::text, o."id", u."id", 'owner', CASE WHEN u."isActive" THEN 'active' ELSE 'disabled' END::"public"."StaffStatus",
       u."phone", COALESCE(u."first_name", ''), u."last_name", CASE WHEN u."isActive" THEN o."created_at" END
FROM "public"."organization" o
JOIN "public"."user" u ON u."id" = o."owner_id";

-- DropForeignKey
ALTER TABLE "public"."organization" DROP CONSTRAINT "organization_owner_id_fkey";

-- DropIndex
DROP INDEX "public"."organization_owner_id_key";

-- AlterTable
ALTER TABLE "public"."organization" DROP COLUMN "owner_id";
