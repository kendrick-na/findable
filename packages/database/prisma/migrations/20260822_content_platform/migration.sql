-- SEO/GEO 퍼블리싱 플랫폼
-- 진단 액션에서 생성된 초안을 고객사/Findable 퍼블리셔가 검수하고 공개 발행한다.

CREATE TYPE "PublisherKind" AS ENUM ('findable', 'brand');
CREATE TYPE "ContentStatus" AS ENUM ('draft', 'publisher_review', 'quality_check', 'moderation_review', 'published', 'archived');
CREATE TYPE "ContentReviewEventType" AS ENUM ('generated', 'edited', 'submitted', 'approved', 'rejected', 'moderation_approved', 'moderation_rejected', 'published', 'archived');
CREATE TYPE "ContentQualityStatus" AS ENUM ('passed', 'warning', 'failed');
CREATE TYPE "PublicationJobStatus" AS ENUM ('queued', 'processing', 'completed', 'failed');

CREATE TABLE "Publisher" (
    "id" TEXT NOT NULL,
    "kind" "PublisherKind" NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "websiteUrl" TEXT,
    "logoUrl" TEXT,
    "brandId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Publisher_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Content" (
    "id" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "sourceActionKind" TEXT,
    "sourceActionTarget" TEXT,
    "sourceMeasuredAt" TIMESTAMP(3),
    "locale" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "excerpt" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "noindex" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Content_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentRevision" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "excerpt" TEXT,
    "sourceEvidence" JSONB,
    "sourceMetrics" JSONB,
    "generationPrompt" TEXT,
    "model" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentReviewEvent" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "type" "ContentReviewEventType" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentReviewEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentQualityCheck" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "status" "ContentQualityStatus" NOT NULL,
    "checks" JSONB NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentQualityCheck_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicationJob" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "status" "PublicationJobStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PublicationJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Publisher_slug_key" ON "Publisher"("slug");
CREATE UNIQUE INDEX "Publisher_brandId_key" ON "Publisher"("brandId");
CREATE INDEX "Publisher_kind_idx" ON "Publisher"("kind");
CREATE INDEX "Content_publisherId_status_idx" ON "Content"("publisherId", "status");
CREATE INDEX "Content_status_publishedAt_idx" ON "Content"("status", "publishedAt");
CREATE UNIQUE INDEX "Content_publisherId_locale_slug_key" ON "Content"("publisherId", "locale", "slug");
CREATE INDEX "ContentRevision_contentId_createdAt_idx" ON "ContentRevision"("contentId", "createdAt");
CREATE UNIQUE INDEX "ContentRevision_contentId_version_key" ON "ContentRevision"("contentId", "version");
CREATE INDEX "ContentReviewEvent_contentId_createdAt_idx" ON "ContentReviewEvent"("contentId", "createdAt");
CREATE INDEX "ContentQualityCheck_contentId_createdAt_idx" ON "ContentQualityCheck"("contentId", "createdAt");
CREATE INDEX "PublicationJob_status_scheduledAt_idx" ON "PublicationJob"("status", "scheduledAt");
CREATE INDEX "PublicationJob_contentId_createdAt_idx" ON "PublicationJob"("contentId", "createdAt");
