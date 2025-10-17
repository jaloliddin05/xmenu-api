-- CreateEnum
CREATE TYPE "additional_product_group_type" AS ENUM ('checkbox', 'radio');

-- CreateEnum
CREATE TYPE "product_unit" AS ENUM ('gr', 'ml');

-- AlterTable
ALTER TABLE "file" ADD COLUMN     "product_id" TEXT;

-- CreateTable
CREATE TABLE "additional_product_group_translation" (
    "id" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "additional_product_group_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "additional_product_group_translation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "additional_product_group" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_required" BOOLEAN DEFAULT false,
    "type" "additional_product_group_type" NOT NULL,
    "product_id" TEXT NOT NULL,

    CONSTRAINT "additional_product_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "additional_product_translation" (
    "id" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "additional_product_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "additional_product_translation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "additional_product" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "price" DOUBLE PRECISION NOT NULL,
    "additional_product_group_id" TEXT NOT NULL,

    CONSTRAINT "additional_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_translation" (
    "id" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "product_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_translation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN DEFAULT true,
    "index" INTEGER,
    "price" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION,
    "protein" DOUBLE PRECISION,
    "kcal" DOUBLE PRECISION,
    "fat" DOUBLE PRECISION,
    "carbohydrate" DOUBLE PRECISION,
    "unit" "product_unit" NOT NULL,
    "category_id" TEXT NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "file" ADD CONSTRAINT "file_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_product_group_translation" ADD CONSTRAINT "additional_product_group_translation_additional_product_gr_fkey" FOREIGN KEY ("additional_product_group_id") REFERENCES "additional_product_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_product_group" ADD CONSTRAINT "additional_product_group_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_product_translation" ADD CONSTRAINT "additional_product_translation_additional_product_id_fkey" FOREIGN KEY ("additional_product_id") REFERENCES "additional_product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_product" ADD CONSTRAINT "additional_product_additional_product_group_id_fkey" FOREIGN KEY ("additional_product_group_id") REFERENCES "additional_product_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_translation" ADD CONSTRAINT "product_translation_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
