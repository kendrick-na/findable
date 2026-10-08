-- Additive, flag-gated migration for the W1 saved-question attempt ledger.
-- Creates two new tables and one enum only; no existing table is altered,
-- no backfill or delete is performed. Runtime reads/writes stay off until
-- PROMPT_ATTEMPT_LEDGER_ENABLED="true" (enable order: apply this, then flip flag).
-- CreateEnum
CREATE TYPE "PromptAttemptOutcome" AS ENUM ('completed', 'failed', 'unverified', 'abandoned');

-- CreateTable
CREATE TABLE "PromptAttempt" (
    "id" TEXT NOT NULL,
    "auditJobId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "selectionSeq" INTEGER NOT NULL,
    "planIndex" INTEGER NOT NULL,
    "planSize" INTEGER NOT NULL,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "leaseToken" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "startedLeaseToken" TEXT,
    "finishedAt" TIMESTAMP(3),
    "outcome" "PromptAttemptOutcome",

    CONSTRAINT "PromptAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptAttemptReset" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "reason" TEXT,
    "resetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptAttemptReset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromptAttempt_brandId_promptId_selectionSeq_idx" ON "PromptAttempt"("brandId", "promptId", "selectionSeq");

-- CreateIndex
CREATE UNIQUE INDEX "PromptAttempt_auditJobId_promptId_key" ON "PromptAttempt"("auditJobId", "promptId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptAttempt_auditJobId_planIndex_key" ON "PromptAttempt"("auditJobId", "planIndex");

-- CreateIndex
CREATE UNIQUE INDEX "PromptAttempt_brandId_selectionSeq_key" ON "PromptAttempt"("brandId", "selectionSeq");

-- CreateIndex
CREATE INDEX "PromptAttemptReset_brandId_promptId_idx" ON "PromptAttemptReset"("brandId", "promptId");
