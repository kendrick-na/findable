-- 질문 묶음 완료 즉시 저장. 기존 AuditJob은 NULL이며 운영 DB에는 별도 승인 후 적용.
ALTER TABLE "AuditJob" ADD COLUMN "checkpoint" JSONB;
ALTER TABLE "AuditJob" ADD COLUMN "leaseToken" TEXT;
ALTER TABLE "AuditJob" ADD COLUMN "leaseUntil" TIMESTAMP(3);
ALTER TABLE "AuditJob" ADD COLUMN "attemptStartedAt" TIMESTAMP(3);
