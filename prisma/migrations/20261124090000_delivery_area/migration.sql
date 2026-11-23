-- Venue delivery area (docs/DELIVERY.md, "Общая зона доставки заведения"): parts (catalog regions or drawn
-- outlines) and the default price. Both tables go with the venue (ON DELETE CASCADE).
-- CreateEnum
CREATE TYPE "DeliveryAreaSource" AS ENUM ('region', 'custom');

-- CreateTable
CREATE TABLE "delivery_area" (
    "organization_id" TEXT NOT NULL,
    "base_price" INTEGER NOT NULL,
    "included_km" DOUBLE PRECISION NOT NULL,
    "price_per_km" INTEGER NOT NULL,
    "min_order" INTEGER NOT NULL,
    "free_from" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_area_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "delivery_area_part" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "source" "DeliveryAreaSource" NOT NULL,
    "region_code" TEXT,
    "catalog_version" TEXT,
    "geometry" JSONB NOT NULL,

    CONSTRAINT "delivery_area_part_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_area_part_organization_id_position_idx" ON "delivery_area_part"("organization_id", "position");

-- AddForeignKey
ALTER TABLE "delivery_area" ADD CONSTRAINT "delivery_area_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_area_part" ADD CONSTRAINT "delivery_area_part_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

