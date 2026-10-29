-- AlterTable
ALTER TABLE "public"."customer_order" ALTER COLUMN "currency" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."organization_order_settings" ALTER COLUMN "delivery_service_fee" DROP DEFAULT,
ALTER COLUMN "min_order_delivery" DROP DEFAULT,
ALTER COLUMN "min_order_pickup" DROP DEFAULT,
ALTER COLUMN "eta_min" DROP DEFAULT,
ALTER COLUMN "eta_max" DROP DEFAULT,
ALTER COLUMN "acceptance_timeout_seconds" DROP DEFAULT,
ALTER COLUMN "payment_timeout_seconds" DROP DEFAULT,
ALTER COLUMN "max_active_orders" DROP DEFAULT;

-- CreateTable
CREATE TABLE "public"."organization_settings" (
    "organization_id" TEXT NOT NULL,
    "theme" JSONB,
    "currency" TEXT NOT NULL,
    "default_language" TEXT NOT NULL,
    "languages" TEXT[],
    "support_phone" TEXT,
    "support_telegram" TEXT,
    "support_hours" TEXT,
    "address" TEXT,
    "founded_year" INTEGER,
    "city" TEXT,
    "map_center_lat" DOUBLE PRECISION,
    "map_center_lng" DOUBLE PRECISION,
    "map_zoom" INTEGER,
    "map_bounds" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_settings_pkey" PRIMARY KEY ("organization_id")
);

-- AddForeignKey
ALTER TABLE "public"."organization_settings" ADD CONSTRAINT "organization_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
