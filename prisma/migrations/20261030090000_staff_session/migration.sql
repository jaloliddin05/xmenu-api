-- CreateTable
CREATE TABLE "public"."staff_session" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "family_started_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "parent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "user_agent" TEXT,
    "ip" TEXT,

    CONSTRAINT "staff_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_session_token_hash_key" ON "public"."staff_session"("token_hash");

-- CreateIndex
CREATE INDEX "staff_session_family_id_idx" ON "public"."staff_session"("family_id");

-- CreateIndex
CREATE INDEX "staff_session_user_id_idx" ON "public"."staff_session"("user_id");

-- AddForeignKey
ALTER TABLE "public"."staff_session" ADD CONSTRAINT "staff_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

