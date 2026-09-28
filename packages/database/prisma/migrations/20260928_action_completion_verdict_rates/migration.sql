-- 근거 등급 액션(2026-09-28): 조치 전후를 SoV 뿐 아니라 오인율·정확 설명률로도 본다.
-- ⚠️ 아직 적용하지 않았다. 모두 NULL 허용 컬럼 추가라 기존 행·쿼리에 영향 없음.
-- ⚠️ 이 스키마가 배포되기 **전에** 반드시 먼저 적용할 것(Prisma 가 새 컬럼을 SELECT 한다).
ALTER TABLE "ActionCompletion"
  ADD COLUMN "misidentificationRateAtCompletion" DOUBLE PRECISION,
  ADD COLUMN "accurateRateAtCompletion" DOUBLE PRECISION,
  ADD COLUMN "startedAt" TIMESTAMP(3);
