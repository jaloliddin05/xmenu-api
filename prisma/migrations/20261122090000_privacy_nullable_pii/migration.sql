-- Guest anonymization (S-07): phone, name and the order phone become NULL when the guest deletes the account
-- or the retention period passes. Sums, items, statuses and dates stay.
ALTER TABLE "customer" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "customer" ALTER COLUMN "name" DROP NOT NULL;
ALTER TABLE "customer_order" ALTER COLUMN "phone" DROP NOT NULL;
