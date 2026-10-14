-- AnswerBrand (2026-10-15, 경쟁사 빈틈 분석): 측정 답변 1개에서 AI가 나열한 브랜드 이름 캐시. Additive only: 새 테이블 1개.
-- 측정 결과(AuditJob.result)는 수정하지 않는 원본이라 파생 계산은 여기에 따로 둔다.
-- 앱은 이 테이블을 raw SQL 로만 읽고 쓴다(Prisma 스키마 불변) — 테이블이 아직 없어도 분석 버튼만 '준비 중'이 되고 다른 기능은 영향 없음.
-- NOT applied to any database yet unless noted in docs/_적용. (기존 테이블과 같은 관례로 RLS 없음)
CREATE TABLE IF NOT EXISTS "AnswerBrand" (
  "auditJobId" TEXT NOT NULL,
  "promptIndex" INTEGER NOT NULL,
  "engineId" TEXT NOT NULL,
  "brands" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnswerBrand_pkey" PRIMARY KEY ("auditJobId", "promptIndex", "engineId")
);
