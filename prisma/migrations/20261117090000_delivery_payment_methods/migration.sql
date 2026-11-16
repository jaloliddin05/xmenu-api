-- AlterEnum
ALTER TYPE "public"."OrderPaymentMethod" ADD VALUE 'card';

-- AlterTable
ALTER TABLE "public"."organization_order_settings" ADD COLUMN     "delivery_pay_card" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "delivery_pay_cash" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "delivery_pay_online" BOOLEAN NOT NULL DEFAULT false;

-- Existing rows got the platform defaults (cash only); new rows get them from platform-defaults.ts (no DEFAULT in the DB)
ALTER TABLE "public"."organization_order_settings" ALTER COLUMN "delivery_pay_card" DROP DEFAULT,
ALTER COLUMN "delivery_pay_cash" DROP DEFAULT,
ALTER COLUMN "delivery_pay_online" DROP DEFAULT;
