-- CreateEnum
CREATE TYPE "public"."TenantDomainStatus" AS ENUM ('pending', 'verified');

-- CreateTable
CREATE TABLE "public"."tenant_domain" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "status" "public"."TenantDomainStatus" NOT NULL DEFAULT 'pending',
    "verified_host" TEXT,
    "verification_token" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "last_check_at" TIMESTAMP(3),
    "last_check_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_domain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_domain_verified_host_key" ON "public"."tenant_domain"("verified_host");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_domain_organization_id_host_key" ON "public"."tenant_domain"("organization_id", "host");

-- AddForeignKey
ALTER TABLE "public"."tenant_domain" ADD CONSTRAINT "tenant_domain_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

