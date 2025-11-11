-- CreateTable
CREATE TABLE "application" (
    "id" TEXT NOT NULL,
    "fullName" TEXT,
    "phone" TEXT,
    "from" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_pkey" PRIMARY KEY ("id")
);
