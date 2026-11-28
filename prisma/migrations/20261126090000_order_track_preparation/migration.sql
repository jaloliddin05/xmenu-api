-- Kitchen queue of deliveries (docs/DELIVERY.md, "Статусы заказа"): off by default, existing venues keep
-- accepted -> ready.
-- AlterTable
ALTER TABLE "organization_order_settings" ADD COLUMN     "track_preparation" BOOLEAN NOT NULL DEFAULT false;
