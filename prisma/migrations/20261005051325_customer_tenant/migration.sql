/*
  Warnings:

  - You are about to drop the column `first_name` on the `customer` table. All the data in the column will be lost.
  - You are about to drop the column `last_name` on the `customer` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[organization_id,telegram_id]` on the table `customer` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `name` to the `customer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `organization_id` to the `customer` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."CustomerStatus" AS ENUM ('active', 'blocked');

-- DropIndex
DROP INDEX "public"."customer_phone_key";

-- DropIndex
DROP INDEX "public"."customer_telegram_id_key";

-- AlterTable
ALTER TABLE "public"."customer" DROP COLUMN "first_name",
DROP COLUMN "last_name",
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "last_login_at" TIMESTAMP(3),
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "organization_id" TEXT NOT NULL,
ADD COLUMN     "status" "public"."CustomerStatus" NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "public"."customer_auth_event" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" TEXT,
    "customer_id" TEXT,
    "type" TEXT NOT NULL,
    "phone_masked" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_auth_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customer_session" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "family_started_at" TIMESTAMP(3) NOT NULL,
    "customer_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "parent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "user_agent" TEXT,
    "ip" TEXT,

    CONSTRAINT "customer_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_auth_event_created_at_idx" ON "public"."customer_auth_event"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_session_token_hash_key" ON "public"."customer_session"("token_hash");

-- CreateIndex
CREATE INDEX "customer_session_family_id_idx" ON "public"."customer_session"("family_id");

-- CreateIndex
CREATE INDEX "customer_session_customer_id_idx" ON "public"."customer_session"("customer_id");

-- CreateIndex
CREATE INDEX "customer_organization_id_phone_idx" ON "public"."customer"("organization_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "customer_organization_id_telegram_id_key" ON "public"."customer"("organization_id", "telegram_id");

-- AddForeignKey
ALTER TABLE "public"."customer_session" ADD CONSTRAINT "customer_session_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer" ADD CONSTRAINT "customer_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
