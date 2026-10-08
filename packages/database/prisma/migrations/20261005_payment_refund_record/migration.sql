-- Additive migration for the durable PaymentRefund record.
-- Creates one enum and one table only; no existing table is altered,
-- no backfill or delete is performed. The app tolerates this table being
-- absent (deploy-before-migrate): refund fences fall back to the previous
-- org-status + live PortOne lookup and log once.
-- CreateEnum
CREATE TYPE "PaymentRefundKind" AS ENUM ('full', 'partial');

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "kind" "PaymentRefundKind" NOT NULL,
    "refundedAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_paymentId_key" ON "PaymentRefund"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentRefund_organizationId_refundedAt_idx" ON "PaymentRefund"("organizationId", "refundedAt");

-- CreateIndex
CREATE INDEX "PaymentRefund_userId_idx" ON "PaymentRefund"("userId");
