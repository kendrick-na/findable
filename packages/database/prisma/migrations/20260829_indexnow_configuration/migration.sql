-- Persist verified IndexNow setup and submission evidence per customer brand.
CREATE TABLE "IndexNowConfiguration" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "brandId" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'configured',
  "keyVerifiedAt" TIMESTAMP(3),
  "lastSubmittedAt" TIMESTAMP(3),
  "lastSubmittedCount" INTEGER,
  "lastHttpStatus" INTEGER,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IndexNowConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IndexNowConfiguration_brandId_key"
  ON "IndexNowConfiguration"("brandId");
CREATE INDEX "IndexNowConfiguration_organizationId_updatedAt_idx"
  ON "IndexNowConfiguration"("organizationId", "updatedAt");
CREATE INDEX "IndexNowConfiguration_status_idx"
  ON "IndexNowConfiguration"("status");
