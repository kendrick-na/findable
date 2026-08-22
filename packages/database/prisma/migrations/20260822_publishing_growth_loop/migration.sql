-- Ghost/Substack형 퍼블리싱 성장 루프: 예약 발행, 뉴스레터, 고객 전용 도메인.

ALTER TYPE "ContentStatus" ADD VALUE 'scheduled' BEFORE 'published';
ALTER TYPE "ContentReviewEventType" ADD VALUE 'scheduled' BEFORE 'published';
ALTER TYPE "PublicationJobStatus" ADD VALUE 'cancelled';

CREATE TYPE "CustomDomainStatus" AS ENUM ('unconfigured', 'pending', 'verified', 'active', 'failed');
CREATE TYPE "NewsletterSubscriptionStatus" AS ENUM ('pending', 'active', 'unsubscribed');
CREATE TYPE "NewsletterCampaignStatus" AS ENUM ('queued', 'processing', 'completed', 'failed');
CREATE TYPE "NewsletterDeliveryStatus" AS ENUM ('queued', 'sent', 'failed');

ALTER TABLE "Publisher"
  ADD COLUMN "customDomain" TEXT,
  ADD COLUMN "customDomainStatus" "CustomDomainStatus" NOT NULL DEFAULT 'unconfigured',
  ADD COLUMN "customDomainVerificationToken" TEXT,
  ADD COLUMN "customDomainVerification" JSONB,
  ADD COLUMN "customDomainUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "newsletterEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Content"
  ADD COLUMN "scheduledAt" TIMESTAMP(3),
  ADD COLUMN "sendNewsletter" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Publisher_customDomain_key" ON "Publisher"("customDomain");
CREATE INDEX "Content_status_scheduledAt_idx" ON "Content"("status", "scheduledAt");

CREATE TABLE "NewsletterSubscription" (
  "id" TEXT NOT NULL,
  "publisherId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'ko',
  "status" "NewsletterSubscriptionStatus" NOT NULL DEFAULT 'pending',
  "confirmationTokenHash" TEXT,
  "unsubscribeTokenHash" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "unsubscribedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NewsletterSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NewsletterCampaign" (
  "id" TEXT NOT NULL,
  "contentId" TEXT NOT NULL,
  "status" "NewsletterCampaignStatus" NOT NULL DEFAULT 'queued',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NewsletterCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NewsletterDelivery" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "status" "NewsletterDeliveryStatus" NOT NULL DEFAULT 'queued',
  "providerId" TEXT,
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NewsletterDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NewsletterSubscription_confirmationTokenHash_key" ON "NewsletterSubscription"("confirmationTokenHash");
CREATE UNIQUE INDEX "NewsletterSubscription_unsubscribeTokenHash_key" ON "NewsletterSubscription"("unsubscribeTokenHash");
CREATE UNIQUE INDEX "NewsletterSubscription_publisherId_email_key" ON "NewsletterSubscription"("publisherId", "email");
CREATE INDEX "NewsletterSubscription_publisherId_status_idx" ON "NewsletterSubscription"("publisherId", "status");
CREATE UNIQUE INDEX "NewsletterCampaign_contentId_key" ON "NewsletterCampaign"("contentId");
CREATE INDEX "NewsletterCampaign_status_createdAt_idx" ON "NewsletterCampaign"("status", "createdAt");
CREATE UNIQUE INDEX "NewsletterDelivery_campaignId_subscriptionId_key" ON "NewsletterDelivery"("campaignId", "subscriptionId");
CREATE INDEX "NewsletterDelivery_status_createdAt_idx" ON "NewsletterDelivery"("status", "createdAt");
