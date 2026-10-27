-- customer_address: indexes and integrity rules the table was created without.
--
-- 1. No index on customer_id. Postgres does not index foreign keys on its
--    own, so "list this customer's addresses" (every cart open) was a
--    sequential scan that grows with the table.
-- 2. Nothing stopped a customer from having several default addresses. The
--    application keeps it to one inside a transaction that locks the
--    customer row, but the database is the last line of defence against a
--    bug or a manual edit — hence a partial unique index. Prisma's schema
--    language cannot express a filtered index, so it lives only here.
-- 3. Coordinates must be both set or both empty, and on Earth. A lone
--    latitude is unusable for delivery and a typo like 411.31 would
--    silently put the pin in the ocean.

-- Rows written before this migration could in theory hold several defaults
-- per customer; keep the most recently updated one so the unique index
-- below cannot fail on old data.
UPDATE "public"."customer_address" AS a
SET "is_default" = false
WHERE a."is_default" = true
  AND a."id" <> (
    SELECT b."id"
    FROM "public"."customer_address" AS b
    WHERE b."customer_id" = a."customer_id" AND b."is_default" = true
    ORDER BY b."updated_at" DESC, b."id"
    LIMIT 1
  );

CREATE INDEX "customer_address_customer_id_idx"
  ON "public"."customer_address" ("customer_id");

CREATE UNIQUE INDEX "customer_address_customer_id_default_key"
  ON "public"."customer_address" ("customer_id")
  WHERE "is_default" = true;

ALTER TABLE "public"."customer_address"
  ADD CONSTRAINT "customer_address_coordinates_check" CHECK (
    ("latitude" IS NULL) = ("longitude" IS NULL)
    AND ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90)
    AND ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180)
  );
