-- Additive migration for the pre-renewal notice ledger (RenewalNotice).
-- Creates one table only; no existing table is altered, no backfill or
-- delete is performed. The app tolerates this table being absent
-- (deploy-before-migrate): the renewal-notice cron step sends nothing.
-- CreateTable
CREATE TABLE "RenewalNotice" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenewalNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RenewalNotice_paymentId_key" ON "RenewalNotice"("paymentId");

-- CreateIndex
CREATE INDEX "RenewalNotice_organizationId_idx" ON "RenewalNotice"("organizationId");
