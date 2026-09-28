-- 고객 웹 리포트 공유 링크 + 열람 기록 (2026-09-28, feat/client-report-link-20260928).
-- ⚠️ 원격 DB 미적용. 적용 전 사람 승인 필요. 기존 행에는 영향 없음(nullable 컬럼 추가 + 새 테이블).
-- relationMode="prisma" 라 FK 제약은 만들지 않는다(다른 마이그레이션과 같은 방식).

ALTER TABLE "Report" ADD COLUMN "accessToken" TEXT;
CREATE UNIQUE INDEX "Report_accessToken_key" ON "Report"("accessToken");

CREATE TABLE "ReportView" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uaHash" TEXT,
  CONSTRAINT "ReportView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportView_reportId_viewedAt_idx" ON "ReportView"("reportId", "viewedAt");
