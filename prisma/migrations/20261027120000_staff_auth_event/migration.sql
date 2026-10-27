-- CreateTable
CREATE TABLE "public"."staff_auth_event" (
    "id" BIGSERIAL NOT NULL,
    "user_id" TEXT,
    "organization_id" TEXT,
    "type" TEXT NOT NULL,
    "phone_masked" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_auth_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_auth_event_created_at_idx" ON "public"."staff_auth_event"("created_at");

-- CreateIndex
CREATE INDEX "staff_auth_event_user_id_idx" ON "public"."staff_auth_event"("user_id");
