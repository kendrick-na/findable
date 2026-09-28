-- 운영자 Google Workspace 연결과 발송 전 초안 이력. 실제 발송 기능은 없다.
CREATE TABLE "MailboxConnection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "encryptedRefreshToken" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'connected',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MailboxConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MailboxConnection_organizationId_userId_provider_key"
  ON "MailboxConnection"("organizationId", "userId", "provider");
CREATE INDEX "MailboxConnection_organizationId_updatedAt_idx"
  ON "MailboxConnection"("organizationId", "updatedAt");

CREATE TABLE "OutreachDraft" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "bodyHash" TEXT NOT NULL,
  "remoteDraftId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutreachDraft_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OutreachDraft_organizationId_userId_idempotencyKey_key"
  ON "OutreachDraft"("organizationId", "userId", "idempotencyKey");
CREATE INDEX "OutreachDraft_organizationId_createdAt_idx"
  ON "OutreachDraft"("organizationId", "createdAt");
CREATE INDEX "OutreachDraft_connectionId_idx"
  ON "OutreachDraft"("connectionId");
