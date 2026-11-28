-- Web push subscriptions of staff browsers (docs/API.md, "Web push сотрудникам"); they go with the user
-- and with the venue (ON DELETE CASCADE).
-- CreateTable
CREATE TABLE "staff_push_subscription" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_success_at" TIMESTAMP(3),
    "failure_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "staff_push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_push_subscription_endpoint_key" ON "staff_push_subscription"("endpoint");

-- CreateIndex
CREATE INDEX "staff_push_subscription_organization_id_idx" ON "staff_push_subscription"("organization_id");

-- CreateIndex
CREATE INDEX "staff_push_subscription_user_id_idx" ON "staff_push_subscription"("user_id");

-- AddForeignKey
ALTER TABLE "staff_push_subscription" ADD CONSTRAINT "staff_push_subscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_push_subscription" ADD CONSTRAINT "staff_push_subscription_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
