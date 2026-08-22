-- 회원가입/온보딩 진행 상태를 측정 성공 여부와 분리한다.
-- 측정 실패·한도 초과여도 사용자가 설정을 끝냈다면 다시 온보딩에 갇히지 않아야 한다.
ALTER TABLE "Organization"
  ADD COLUMN "onboardingStep" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);
