-- CreateTable
CREATE TABLE "public"."organization_telegram_bot" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "telegram_bot_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "webhook_secret" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_telegram_bot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_telegram_bot_organization_id_key" ON "public"."organization_telegram_bot"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_telegram_bot_telegram_bot_id_key" ON "public"."organization_telegram_bot"("telegram_bot_id");

-- AddForeignKey
ALTER TABLE "public"."organization_telegram_bot" ADD CONSTRAINT "organization_telegram_bot_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
