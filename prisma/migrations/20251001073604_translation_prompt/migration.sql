-- CreateTable
CREATE TABLE "translation_prompt" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "translation_prompt_pkey" PRIMARY KEY ("id")
);
