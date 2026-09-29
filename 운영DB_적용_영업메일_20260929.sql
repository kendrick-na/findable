-- Findable 영업 메일 초안 기능 — 운영 DB 적용 (2026-09-29)
-- 표 2개와 색인만 새로 만든다. 기존 표는 건드리지 않는다. 여러 번 실행해도 안전(IF NOT EXISTS).

-- CreateTable
CREATE TABLE IF NOT EXISTS "MailboxConnection" (
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
CREATE TABLE IF NOT EXISTS "OutreachDraft" (
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
CREATE INDEX IF NOT EXISTS "MailboxConnection_organizationId_updatedAt_idx" ON "MailboxConnection"("organizationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MailboxConnection_organizationId_userId_provider_key" ON "MailboxConnection"("organizationId", "userId", "provider");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OutreachDraft_organizationId_createdAt_idx" ON "OutreachDraft"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OutreachDraft_organizationId_leadId_idx" ON "OutreachDraft"("organizationId", "leadId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OutreachDraft_connectionId_idx" ON "OutreachDraft"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OutreachDraft_organizationId_userId_idempotencyKey_key" ON "OutreachDraft"("organizationId", "userId", "idempotencyKey");


-- 확인: 아래 결과에 2줄(MailboxConnection, OutreachDraft)이 나오면 성공
SELECT table_name FROM information_schema.tables WHERE table_name IN ('MailboxConnection','OutreachDraft');
