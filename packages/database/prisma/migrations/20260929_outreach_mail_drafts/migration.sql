-- 운영자 영업 메일 초안 (2026-09-29). Gmail 연결 정보와 「초안 저장」 이력만 담는다. 발송 기능·발송 기록 없음.
-- 추가만 한다(기존 표 변경 없음).
-- CreateTable
CREATE TABLE "MailboxConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'connected',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachDraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "leadId" TEXT,
    "sender" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "remoteDraftId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailboxConnection_organizationId_updatedAt_idx" ON "MailboxConnection"("organizationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxConnection_organizationId_userId_provider_key" ON "MailboxConnection"("organizationId", "userId", "provider");

-- CreateIndex
CREATE INDEX "OutreachDraft_organizationId_createdAt_idx" ON "OutreachDraft"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "OutreachDraft_organizationId_leadId_idx" ON "OutreachDraft"("organizationId", "leadId");

-- CreateIndex
CREATE INDEX "OutreachDraft_connectionId_idx" ON "OutreachDraft"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachDraft_organizationId_userId_idempotencyKey_key" ON "OutreachDraft"("organizationId", "userId", "idempotencyKey");

