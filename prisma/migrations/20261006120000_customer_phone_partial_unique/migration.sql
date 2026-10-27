-- One ACTIVE customer per (tenant, phone).
--
-- The previous migration (20261005051325_customer_tenant) added a plain
-- index on (organization_id, phone) but never the UNIQUE constraint the
-- Prisma model's comment claims exists. Without it, two concurrent
-- POST /auth/customer/register calls for the same phone (e.g. a retried
-- request) can each pass the SELECT-by-phone check before either INSERT
-- commits, producing two customer rows for one phone number — and the
-- P2002 race-recovery branch in CustomerAuthService.register() silently
-- never fires, because nothing ever violates a constraint.
--
-- Prisma's schema language has no way to express a FILTERED unique index
-- (see https://github.com/prisma/prisma/issues/3388), so it is created
-- by hand here. `deleted_at IS NULL` is why it must be partial: once
-- customer soft-delete ships, the same phone number needs to be
-- re-registrable in the same tenant after the old row is gone, without
-- a dead unique-constraint conflict against history Prisma must keep.
--
-- Safety for existing data: if any (organization_id, phone) pair already
-- has more than one non-deleted row, this migration fails loudly rather
-- than picking a winner — that data needs a manual look first.
CREATE UNIQUE INDEX "customer_organization_id_phone_active_key"
  ON "public"."customer" ("organization_id", "phone")
  WHERE "deleted_at" IS NULL;
