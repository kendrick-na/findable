-- DeletedClerkUser (2026-10-20): 탈퇴한 Clerk 사용자 표식(tombstone). Additive only: 새 테이블 1개.
-- 기존 테이블·칸은 바꾸지 않는다. 개인정보 없음(Clerk id·시각만).
-- 앱은 이 표가 없으면 탈퇴·가입·수정 웹훅을 500 으로 돌려 Clerk 재시도에 맡긴다(fail-closed)
-- → 운영 반영 순서: 이 마이그레이션 적용 → 앱 배포.
-- NOT applied to any database yet unless noted in docs/_적용.
-- CreateTable
CREATE TABLE "DeletedClerkUser" (
    "clerkId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletedClerkUser_pkey" PRIMARY KEY ("clerkId")
);
