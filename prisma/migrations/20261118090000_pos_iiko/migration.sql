-- CreateEnum
CREATE TYPE "public"."PosProviderKind" AS ENUM ('iiko');

-- CreateEnum
CREATE TYPE "public"."PosIntegrationStatus" AS ENUM ('draft', 'active', 'needs_reconnect');

-- CreateEnum
CREATE TYPE "public"."PosAddressFormat" AS ENUM ('city', 'legacy', 'unknown');

-- CreateEnum
CREATE TYPE "public"."PosCourierMode" AS ENUM ('xmenu', 'iiko');

-- CreateEnum
CREATE TYPE "public"."PosPaymentMethod" AS ENUM ('cash', 'card', 'online');

-- CreateEnum
CREATE TYPE "public"."PosMenuLinkKind" AS ENUM ('category', 'product', 'modifier_group', 'modifier', 'size_group', 'size');

-- AlterTable
ALTER TABLE "public"."category_translation" ADD COLUMN     "stale" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."file" ADD COLUMN     "content_hash" TEXT,
ADD COLUMN     "from_pos" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."additional_product_group_translation" ADD COLUMN     "stale" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."additional_product_translation" ADD COLUMN     "stale" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."product_translation" ADD COLUMN     "stale" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."pos_integration" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "provider" "public"."PosProviderKind" NOT NULL DEFAULT 'iiko',
    "status" "public"."PosIntegrationStatus" NOT NULL DEFAULT 'draft',
    "api_key_encrypted" TEXT NOT NULL,
    "external_org_id" TEXT,
    "address_format" "public"."PosAddressFormat",
    "external_menu_id" TEXT,
    "price_category_id" TEXT,
    "delivery_item_id" TEXT,
    "delivery_size_id" TEXT,
    "courier_mode" "public"."PosCourierMode" NOT NULL DEFAULT 'xmenu',
    "source_lang" TEXT,
    "webhook_secret_hash" TEXT,
    "checks" JSONB,
    "checked_at" TIMESTAMP(3),
    "menu_imported_at" TIMESTAMP(3),
    "menu_import_error" TEXT,
    "stop_list_updated_at" TIMESTAMP(3),
    "enabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pos_branch_link" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "terminal_group_id" TEXT NOT NULL,
    "price_category_id" TEXT,

    CONSTRAINT "pos_branch_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pos_payment_link" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "method" "public"."PosPaymentMethod" NOT NULL,
    "payment_type_id" TEXT NOT NULL,
    "payment_type_kind" TEXT NOT NULL,

    CONSTRAINT "pos_payment_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pos_menu_link" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "kind" "public"."PosMenuLinkKind" NOT NULL,
    "external_id" TEXT NOT NULL,
    "size_id" TEXT,
    "category_id" TEXT,
    "product_id" TEXT,
    "group_id" TEXT,
    "option_id" TEXT,
    "source_name" TEXT NOT NULL,
    "source_image_url" TEXT,
    "hidden_in_pos" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_menu_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pos_stop_item" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "pos_stop_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pos_integration_organization_id_key" ON "public"."pos_integration"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_branch_link_branch_id_key" ON "public"."pos_branch_link"("branch_id");

-- CreateIndex
CREATE INDEX "pos_branch_link_integration_id_idx" ON "public"."pos_branch_link"("integration_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_payment_link_integration_id_method_key" ON "public"."pos_payment_link"("integration_id", "method");

-- CreateIndex
CREATE UNIQUE INDEX "pos_menu_link_category_id_key" ON "public"."pos_menu_link"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_menu_link_product_id_key" ON "public"."pos_menu_link"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_menu_link_group_id_key" ON "public"."pos_menu_link"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_menu_link_option_id_key" ON "public"."pos_menu_link"("option_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_menu_link_integration_id_kind_external_id_key" ON "public"."pos_menu_link"("integration_id", "kind", "external_id");

-- CreateIndex
CREATE INDEX "pos_stop_item_integration_id_idx" ON "public"."pos_stop_item"("integration_id");

-- CreateIndex
CREATE INDEX "pos_stop_item_product_id_idx" ON "public"."pos_stop_item"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_stop_item_branch_id_product_id_key" ON "public"."pos_stop_item"("branch_id", "product_id");

-- AddForeignKey
ALTER TABLE "public"."pos_integration" ADD CONSTRAINT "pos_integration_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pos_branch_link" ADD CONSTRAINT "pos_branch_link_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."pos_integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pos_branch_link" ADD CONSTRAINT "pos_branch_link_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pos_payment_link" ADD CONSTRAINT "pos_payment_link_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."pos_integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pos_menu_link" ADD CONSTRAINT "pos_menu_link_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."pos_integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pos_menu_link" ADD CONSTRAINT "pos_menu_link_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pos_menu_link" ADD CONSTRAINT "pos_menu_link_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pos_menu_link" ADD CONSTRAINT "pos_menu_link_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."additional_product_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pos_menu_link" ADD CONSTRAINT "pos_menu_link_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "public"."additional_product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pos_stop_item" ADD CONSTRAINT "pos_stop_item_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."pos_integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pos_stop_item" ADD CONSTRAINT "pos_stop_item_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pos_stop_item" ADD CONSTRAINT "pos_stop_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

