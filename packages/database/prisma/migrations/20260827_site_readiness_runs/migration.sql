-- 가입 시 등록한 도메인의 SEO/GEO 기술 준비도를 백그라운드에서 측정하고
-- 수동 재측정과 같은 이력으로 보존한다.
CREATE TABLE "SiteReadinessRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "brandId" TEXT NOT NULL,
  "targetUrl" TEXT NOT NULL,
  "finalUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "trigger" TEXT NOT NULL DEFAULT 'manual', -- onboarding | brand_create | domain_change | manual
  "report" JSONB,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "SiteReadinessRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SiteReadinessRun_organizationId_createdAt_idx"
  ON "SiteReadinessRun"("organizationId", "createdAt");

CREATE INDEX "SiteReadinessRun_brandId_createdAt_idx"
  ON "SiteReadinessRun"("brandId", "createdAt");

CREATE INDEX "SiteReadinessRun_status_idx"
  ON "SiteReadinessRun"("status");
