-- Findable 인사이트 편집 메타데이터
-- 공개 허브의 섹션·검색·대표 이미지와 CMS의 SEO 미리보기를 지원한다.

ALTER TABLE "Content"
ADD COLUMN "contentType" TEXT NOT NULL DEFAULT 'analysis',
ADD COLUMN "series" TEXT,
ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "coverImageUrl" TEXT,
ADD COLUMN "coverImageAlt" TEXT,
ADD COLUMN "seoTitle" TEXT,
ADD COLUMN "seoDescription" TEXT,
ADD COLUMN "featuredAt" TIMESTAMP(3);

CREATE INDEX "Content_status_contentType_publishedAt_idx"
ON "Content"("status", "contentType", "publishedAt");
