-- Additive migration for in-app refund / withdrawal requests (RefundRequest).
-- Creates one enum and one table only; no existing table is altered,
-- no backfill or delete is performed. The app tolerates this table being
-- absent (deploy-before-migrate): the request action tells the customer to
-- use email instead and alerts the operator; the admin list shows nothing.
-- CreateEnum
CREATE TYPE "RefundRequestStatus" AS ENUM ('pending', 'resolved');

-- CreateTable
CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentId" TEXT,
    "message" TEXT,
    "status" "RefundRequestStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RefundRequest_organizationId_status_idx" ON "RefundRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RefundRequest_createdAt_idx" ON "RefundRequest"("createdAt");
