-- Preferred language of a customer (ru | uz | en); null = the venue default language applies.
ALTER TABLE "public"."customer" ADD COLUMN "language" TEXT;
