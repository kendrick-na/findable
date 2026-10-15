-- BrandFactSheet (2026-10-16, G1 「내 브랜드 정보」): 고객이 확인한 브랜드 사실 1벌. Additive only: 새 테이블 1개.
-- 앱은 이 테이블을 raw SQL 로만 읽고 쓴다(Prisma 스키마 불변) — 테이블이 아직 없으면 카드만 '준비 중'이 되고 다른 기능은 영향 없음.
-- NOT applied to any database yet unless noted in docs/_적용. (기존 테이블과 같은 관례로 RLS 없음)
CREATE TABLE IF NOT EXISTS "BrandFactSheet" (
  "brandId" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrandFactSheet_pkey" PRIMARY KEY ("brandId")
);
